/**
 * Claude Agent SDK prototype: validates that the SDK spawns claude, fires
 * `canUseTool` with full permission data, and streams the result.
 * Run: node scripts/sdk-proto.mjs
 */
import { query } from '@anthropic-ai/claude-agent-sdk';

const stream = query({
  prompt: 'Read the file "README.md" in the current directory and reply with ONLY its first line.',
  options: {
    model: 'claude-opus-5',
    cwd: process.cwd(),
    permissionMode: 'default',
    canUseTool: async (toolName, input, opts) => {
      console.log(`[permission] tool=${toolName} title=${opts.title ?? ''} display=${opts.displayName ?? ''} input=${JSON.stringify(input).slice(0, 120)}`);
      return { behavior: 'allow', toolUseID: opts.toolUseID };
    },
  },
});

const seen = new Set();
for await (const msg of stream) {
  if (msg.type === 'assistant') {
    seen.add('assistant');
    for (const block of msg.message?.content ?? []) {
      if (block.type === 'text') process.stdout.write(block.text);
    }
  } else if (msg.type === 'result') {
    seen.add('result');
    console.log(`\n[result] subtype=${msg.subtype ?? ''} is_error=${msg.is_error ?? false}`);
    if (msg.is_error) console.log('errors:', JSON.stringify(msg.errors ?? []));
  }
}
console.log('event types seen:', [...seen].join(', '));
console.log('PROTO-OK');
