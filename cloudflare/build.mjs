import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
export async function bundle(){const result=await build({entryPoints:[fileURLToPath(new URL('./worker.mjs',import.meta.url))],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',external:['node:*','cloudflare:*'],loader:{'.sql':'text'},logLevel:'silent'});return result.outputFiles[0].text;}
