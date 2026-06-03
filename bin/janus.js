#!/usr/bin/env node
// Global CLI entry: `janus "your query"` from anywhere
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(join(__dirname, '..'));  // ensure .env and node_modules resolve

const { runOrchestrator } = await import('../src/agents/orchestrator.js');
const query = process.argv.slice(2).join(' ') || null;

try {
  const report = await runOrchestrator(query);
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  console.error('[JANUS] Error:', err.message);
  process.exit(1);
}
