import path from 'node:path';

import { dbPath, importDumpFile, projectRoot } from '../server/db.js';

const dumpPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(projectRoot, 'moltchan_full_dump.json');

const result = importDumpFile(dumpPath);

if (result.skipped) {
  console.log(`Skipped import: ${result.reason}`);
} else {
  console.log(`Imported ${result.threads} threads and ${result.replies} replies into ${dbPath}`);
}
