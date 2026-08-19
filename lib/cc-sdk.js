/**
 * Claude Agent SDK mode ("true B"): host a Claude Code agent through the
 * official SDK with EVERY tool use routed through the harness's
 * user-questions channel.
 *
 * This keeps the first-party entitlement (opus/sonnet work, like console
 * mode) while restoring the approval loop: `settings.permissions.ask`
 * forces every tool through `canUseTool`, which awaits the human's answer
 * via `deps.askUser` and returns allow/deny. Tool execution stays inside
 * Claude Code (its own sandbox); the harness gains visibility and control
 * over every tool call it previously lost in console mode.
 *
 * @module dsh-claude-subscriptions/cc-sdk
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildTranscript } from './cc-console.js';

/** Force every built-in tool through the permission gate. */
const ALL_TOOLS = [
  'Bash',
  'Edit',
  'Write',
  'MultiEdit',
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  'TodoWrite',
  'NotebookEdit',
  'Skill',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
  'TaskSearch',
  'ReportFindings',
  'ScheduleWakeup',
  'CronCreate',
  'CronDelete',
  'CronList',
  'EnterWorktree',
  'ExitWorktree',
];

/** Option labels the approval question offers. */
const ALLOW_LABEL = '允许';
const DENY_LABEL = '拒绝';

/**
 * Build the SDK options for one model step.
 * @param options - the harness request.
 * @param deps - `{ askUser, cwd, systemPrompt }`.
 * @returns the SDK `options` object.
 */
export function buildSdkOptions(options, deps) {
  const sdkOptions = {
    model: options.model,
    cwd: deps.cwd ?? process.cwd(),
    permissionMode: 'default',
    settings: {
      permissions: {
        ask: ALL_TOOLS,
        disableBypassPermissionsMode: 'disable',
      },
    },
    canUseTool: async (toolName, input, opts) => {
      let decision;
      try {
        decision = await deps.askUser({
          id: opts.requestId,
          header: 'Claude Code 工具许可',
          question: opts.title ?? opts.displayName ?? toolName,
          detail: `工具: ${toolName}\n参数: ${JSON.stringify(input, null, 2).slice(0, 2000)}`,
          options: [{ label: ALLOW_LABEL }, { label: DENY_LABEL }],
        });
      } catch (error) {
        deps.logError?.(error);
        // Fail closed: an unanswerable permission request denies the tool.
        return { behavior: 'deny', message: '无法确认许可，已拒绝', toolUseID: opts.toolUseID };
      }
      const selected = decision?.answers?.[0]?.selected ?? [];
      if (selected.includes(ALLOW_LABEL)) {
        return { behavior: 'allow', toolUseID: opts.toolUseID };
      }
      return { behavior: 'deny', message: '被用户拒绝', toolUseID: opts.toolUseID };
    },
  };
  const systemPrompt = deps.systemPrompt ?? options.system;
  if (systemPrompt !== undefined && systemPrompt.length > 0) {
    sdkOptions.systemPrompt = systemPrompt;
  }
  return sdkOptions;
}

/**
 * Map one SDK message onto harness StreamChunks. Assistant text becomes
 * text deltas; tool-use blocks are not surfaced (they execute inside Claude
 * Code after the approval gate). The `result` message carries usage and the
 * terminal outcome.
 */
export function mapSdkMessage(message) {
  const chunks = [];
  switch (message.type) {
    case 'assistant': {
      for (const block of message.message?.content ?? []) {
        if (block.type === 'text') {
          const index = nextIndex();
          chunks.push({ type: 'block-start', index, blockType: 'text' });
          chunks.push({ type: 'text-delta', index, text: block.text });
          chunks.push({ type: 'block-end', index, block: { type: 'text', text: block.text } });
        }
        // tool_use blocks execute inside Claude Code — not surfaced.
      }
      break;
    }
    case 'result': {
      if (message.is_error === true) {
        const detail = Array.isArray(message.errors) && message.errors.length > 0
          ? String(message.errors[0])
          : message.subtype ?? 'claude agent error';
        chunks.push({
          type: 'finish',
          reason: { kind: 'error', failure: { message: detail, code: 'PROVIDER_ERROR' } },
        });
        break;
      }
      const usage = message.usage;
      chunks.push({
        type: 'usage',
        usage: {
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          ...(usage?.cache_read_input_tokens !== undefined
            ? { cacheReadTokens: usage.cache_read_input_tokens }
            : {}),
          ...(usage?.cache_creation_input_tokens !== undefined
            ? { cacheWriteTokens: usage.cache_creation_input_tokens }
            : {}),
        },
      });
      chunks.push({ type: 'finish', reason: { kind: 'stop' } });
      break;
    }
    default:
      // system/init, user (tool results), control — handled by the SDK bridge.
      break;
  }
  return chunks;
}

let blockCounter = 0;
function nextIndex() {
  return blockCounter++;
}

/**
 * Stream one model step through the Claude Agent SDK.
 * @param options - the harness request.
 * @param deps - `{ askUser, cwd, systemPrompt, signal, logError }`.
 * @returns harness StreamChunks.
 */
export async function* streamSdk(options, deps) {
  const { stdin } = buildTranscript(options);
  const stream = query({
    prompt: stdin,
    options: buildSdkOptions(options, deps),
  });
  let sawResult = false;
  for await (const message of stream) {
    if (message.type === 'result') sawResult = true;
    const chunks = mapSdkMessage(message);
    for (const chunk of chunks) yield chunk;
  }
  if (!sawResult) {
    throw new Error('claude agent stream ended without a result');
  }
}
