import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {relative,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export const BASELINE='c44018ff40c898a9c4da295e50ad31564136cd2c';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export function baselineBundle(root,options,{sqlEol='checkout'}={}){
 const baseline=new Map();
 return build({...options,plugins:[{name:'read-only-baseline-bundle',setup(api){api.onLoad({filter:/\.(mjs|sql)$/},args=>{const path=relative(root,args.path).split(sep).join('/');if(path.startsWith('../')||path.includes('/node_modules/'))throw Error('Unexpected baseline graph');if(!baseline.has(path))baseline.set(path,execFileSync('git',['show',BASELINE+':'+path],{cwd:root,encoding:'utf8'}));let contents=baseline.get(path).replace(/\r\n/g,'\n');if(path.endsWith('.sql')&&(sqlEol==='crlf'||sqlEol==='checkout'&&readFileSync(args.path,'utf8').includes('\r\n')))contents=contents.replace(/\n/g,'\r\n');return {contents,loader:path.endsWith('.sql')?'text':'js'};});}}]});
}
export function checkoutBundle(options,{sqlEol}={}){
 return build({...options,plugins:[{name:'synthetic-checkout-sql-eol',setup(api){api.onLoad({filter:/\.sql$/},args=>{let contents=readFileSync(args.path,'utf8').replace(/\r\n/g,'\n');if(sqlEol==='crlf')contents=contents.replace(/\n/g,'\r\n');return {contents,loader:'text'};});}}]});
}
