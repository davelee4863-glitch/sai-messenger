import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,safeDataPath} from './store.mjs';
export function backupDatabase(source,destination){const file=safeDataPath(source);if(!existsSync(file))throw new Error('Backup source must already exist; refuse empty replacement');const store=new Store(file);try{return store.backup(destination);}finally{store.close();}}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2);if(!args.includes('--db')||!args.includes('--output'))throw new Error('Use --db <existing-isolated-file> --output <new-backup-file>');console.log(JSON.stringify(backupDatabase(args[args.indexOf('--db')+1],args[args.indexOf('--output')+1])));}
