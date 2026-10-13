import {Store} from './store.mjs';
const args=process.argv.slice(2);
if(!args.includes('--db')||!args.includes('--output'))throw new Error('Use --db <isolated-file> --output <new-backup-file>');
const store=new Store(args[args.indexOf('--db')+1]);try{console.log(JSON.stringify(store.backup(args[args.indexOf('--output')+1])));}finally{store.close();}
