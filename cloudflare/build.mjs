import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
export async function bundle(){const out=fileURLToPath(new URL('./.build/worker.mjs',import.meta.url));await mkdir(new URL('./.build/',import.meta.url),{recursive:true});await build({entryPoints:[fileURLToPath(new URL('./worker.mjs',import.meta.url))],outfile:out,bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['node:*','cloudflare:*'],loader:{'.sql':'text'},logLevel:'silent'});return out;}
