#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(join(__dirname, '..'));
process.argv.splice(2, 0, 'scan');
await import('../src/price.js');
