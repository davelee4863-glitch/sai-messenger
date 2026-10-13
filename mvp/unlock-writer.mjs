import {unlockStoppedWriter} from './writer-lock.mjs';
const args=process.argv.slice(2);if(!args.includes('--offline')||!args.includes('--db'))throw new Error('Stop the single writer first; use --offline --db <isolated-file>');
console.log(JSON.stringify(unlockStoppedWriter(args[args.indexOf('--db')+1])));
