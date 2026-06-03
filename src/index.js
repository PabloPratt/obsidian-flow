import { runOrchestrator } from './agents/orchestrator.js';

const query = process.argv.slice(2).join(' ') || null;

try {
  const report = await runOrchestrator(query);
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  console.error('[JANUS] Fatal error:', err.message);
  process.exit(1);
}
