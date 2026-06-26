import fs from 'node:fs';
import path from 'node:path';

import { dbPath, importUpstashExportFile, projectRoot } from '../server/db.js';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const explicitPath = args.find((arg) => arg !== '--reset');

function findLatestExport() {
  const dataDir = path.join(projectRoot, '.data');
  if (!fs.existsSync(dataDir)) return null;

  const candidates = fs.readdirSync(dataDir)
    .filter((name) => name.startsWith('upstash-export-') && name.endsWith('.json'))
    .map((name) => path.join(dataDir, name))
    .sort();

  return candidates.at(-1) || null;
}

const exportPath = explicitPath ? path.resolve(explicitPath) : findLatestExport();

if (!exportPath) {
  console.error('No export path supplied and no .data/upstash-export-*.json file found.');
  process.exit(1);
}

if (!fs.existsSync(exportPath)) {
  console.error(`Export file not found: ${exportPath}`);
  process.exit(1);
}

const stats = importUpstashExportFile(exportPath, { reset });

console.log(`Imported ${exportPath}`);
console.log(`SQLite database: ${dbPath}`);
console.log(JSON.stringify(stats, null, 2));
