import {mkdirSync,cpSync,writeFileSync,readFileSync,readdirSync,lstatSync,existsSync} from 'node:fs';
import {resolve,dirname,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {containsSecret,sensitivePath} from '../harness/check.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(root,'docs'), output=resolve(process.argv[2]||resolve(root,'../pm004/site'));
const sha=process.env.GITHUB_SHA||'LOCAL_PREVIEW';
if(sha!=='LOCAL_PREVIEW'&&!/^[a-f0-9]{40}$/i.test(sha))throw new Error('Invalid source commit');

// Never overlay the checkout or a previous artifact. Existing files could leak
// into Pages even though they were never present in the reviewed docs source.
const comparable=path=>process.platform==='win32'?path.toLowerCase():path;
const checkout=comparable(root), target=comparable(output);
if(target===checkout||target.startsWith(checkout+sep)||checkout.startsWith(target+sep))throw new Error('Build output must be outside and separate from the checkout');
function rejectSymlinkAncestors(path) {
 for(let current=path;;current=dirname(current)) {
  try {if(lstatSync(current).isSymbolicLink())throw new Error('Build path symlink rejected');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(dirname(current)===current)break;
 }
}
rejectSymlinkAncestors(source);
rejectSymlinkAncestors(output);
if(existsSync(output)&&(!lstatSync(output).isDirectory()||readdirSync(output).length))throw new Error('Build output must be a new or empty directory');
function inspect(dir) {
 if(!lstatSync(dir).isDirectory())throw new Error('Static source directory required');
 for(const item of readdirSync(dir,{withFileTypes:true})) {
  const path=resolve(dir,item.name);
  const info=lstatSync(path);
  if(info.isSymbolicLink())throw new Error('Publish symlink rejected');
  if(item.isDirectory())inspect(path);
  else {
   if(!info.isFile()||sensitivePath(item.name)||(item.name!=='.nojekyll'&&!['.html','.mjs','.css','.svg','.json','.webmanifest'].includes(extname(item.name))))throw new Error('Unapproved static publication file');
   if(containsSecret(readFileSync(path,'utf8')))throw new Error('Potential credential in static publication');
  }
 }
}
inspect(source);
const previous=JSON.parse(readFileSync(resolve(source,'version.json'),'utf8'));
if(typeof previous.version!=='string'||!previous.version.trim()||!Array.isArray(previous.changes)||!previous.changes.length||previous.changes.some(change=>typeof change!=='string'||!change.trim()))throw new Error('Invalid version metadata');
const metadata={...previous,sourceCommit:sha,updatedAt:new Date().toISOString()};
mkdirSync(output,{recursive:true});cpSync(source,output,{recursive:true});
writeFileSync(resolve(output,'version.json'),JSON.stringify(metadata,null,2)+'\n');
writeFileSync(resolve(output,'release.mjs'),'export const RELEASE = Object.freeze('+JSON.stringify(metadata,null,2)+');\n');
console.log(JSON.stringify({directory:output,sourceCommit:sha,version:metadata.version}));

