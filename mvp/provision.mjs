import {writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {dirname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Store,safeDataPath} from './store.mjs';
import {passwordHash} from './security.mjs';
export async function provisionSynthetic(dbFile,credentialFile){
 const target=safeDataPath(credentialFile),database=safeDataPath(dbFile);
 if(target===database||dirname(target)===dirname(database)||existsSync(target))throw new Error('Credentials require a new file in a directory separate from the database');
 const store=new Store(database);try{if(store.users().length)throw new Error('Provision only a new isolated database');
  const accounts=[];for(const [handle,nickname] of [['tester-a','합성 A'],['tester-b','합성 B'],['tester-c','합성 C'],['tester-d','합성 D']]){const password=randomBytes(24).toString('base64url');const user=store.addUser(handle,nickname,await passwordHash(password));accounts.push({...user,password});}
  mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,JSON.stringify({purpose:'synthetic local test credentials only',accounts},null,2)+'\n',{flag:'wx',mode:0o600});return {userCount:accounts.length,credentialsWritten:true};
 }finally{store.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2);const db=args[args.indexOf('--db')+1],credentials=args[args.indexOf('--credentials')+1];if(!args.includes('--db')||!args.includes('--credentials'))throw new Error('Use --db and --credentials paths; never pass passwords in arguments');console.log(JSON.stringify(await provisionSynthetic(db,credentials)));}
