import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copySnapshot} from './snapshot.mjs';
export async function backupDatabase(source,destination){await copySnapshot(source,destination);return {schemaVersion:2,integrity:'ok',sourceReadOnly:true};}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2);if(!args.includes('--db')||!args.includes('--output'))throw new Error('Use --db <existing-isolated-file> --output <new-backup-file>');console.log(JSON.stringify(await backupDatabase(args[args.indexOf('--db')+1],args[args.indexOf('--output')+1])));}
