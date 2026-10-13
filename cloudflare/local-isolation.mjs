import {lstatSync,mkdirSync,readdirSync,readFileSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {resolve,parse,join,sep} from 'node:path';
import {configuration} from './config.mjs';
import {OWNERSHIP,ownedIdentity,SAFETY_KEYS} from './isolation-identity.mjs';
export const MARKER='.promise-box-isolation.json';
function reject(message){throw new Error('Cloudflare app isolation: '+message);}
function plainData(value,label){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))reject(label+' must be a plain object');
 for(const key of Reflect.ownKeys(value)){const entry=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!entry.enumerable||!Object.hasOwn(entry,'value'))reject(label+' contains an unsupported property');}
}
export function runtimeOptions(options){
 plainData(options,'runtime options');const allowed=new Set(['persist','port','origin','bindings']);for(const key of Object.keys(options))if(!allowed.has(key))reject('unknown runtime option '+key);
 const {persist,port=0,origin='http://localhost:8787',bindings={}}=options;
 if(typeof persist!=='string'||!persist.trim()||persist.includes('\0'))reject('explicit owned persistence required');
 if(!Number.isInteger(port)||port<0||port>65535)reject('invalid local port');
 let address;try{address=new URL(origin);}catch{reject('invalid local origin');}
 if(typeof origin!=='string'||!['http:','https:'].includes(address.protocol)||!['localhost','127.0.0.1','a.localhost','b.localhost','c.localhost'].includes(address.hostname)||address.username||address.password||address.pathname!=='/'||address.search||address.hash)reject('explicit isolated local origin required');
 plainData(bindings,'runtime bindings');for(const key of Object.keys(bindings))if(!SAFETY_KEYS.includes(key))reject('foreign or immutable runtime binding '+key);
 configuration(bindings);return {persist:resolve(persist),port,origin:address.origin,bindings:{...bindings}};
}
function stat(path){try{return lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function checkAncestors(path){const root=parse(path).root;let current=root;if(root!==path&&stat(join(root,MARKER)))reject('persistence overlaps another storage root');for(const part of path.slice(root.length).split(sep).filter(Boolean)){current=join(current,part);const info=stat(current);if(info?.isSymbolicLink())reject('linked persistence path');if(info&&!info.isDirectory())reject('persistence ancestor is not a directory');if(current!==path&&stat(join(current,MARKER)))reject('persistence overlaps another storage root');}}
function checkTree(path,isRoot=true){for(const name of readdirSync(path)){const child=join(path,name),info=lstatSync(child);if(name===MARKER&&!isRoot)reject('persistence overlaps a nested storage root');if(info.isSymbolicLink()||(info.isFile()&&info.nlink>1))reject('linked persistence entry');if(info.isDirectory())checkTree(child,false);}}
export function ownPersistence(path){
 checkAncestors(path);mkdirSync(path,{recursive:true,mode:0o700});checkAncestors(path);checkTree(path);
 const marker=join(path,MARKER);let current=stat(marker);
 if(!current){if(readdirSync(path).length)reject('nonempty unmarked persistence belongs to an unverified app');
  let fd;try{fd=openSync(marker,'wx',0o600);writeFileSync(fd,JSON.stringify(OWNERSHIP)+'\n');fsyncSync(fd);}catch(error){if(error.code!=='EEXIST')throw error;}finally{if(fd!==undefined)closeSync(fd);}current=stat(marker);
 }
 if(!current?.isFile()||current.isSymbolicLink())reject('invalid persistence ownership marker');
 let identity;try{identity=JSON.parse(readFileSync(marker,'utf8'));}catch{reject('invalid persistence ownership marker');}
 if(!ownedIdentity(identity))reject('foreign persistence ownership');
 return path;
}
