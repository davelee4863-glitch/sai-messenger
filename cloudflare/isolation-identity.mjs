export const APP_ID='davelee4863-glitch/sai-messenger:promise-box';
export const NAMESPACE='promise-box-sai-cf-dev-80f5fa37c2e8';
export const BINDINGS=Object.freeze({workspace:'PBX_CF_WORKSPACE',metadata:'PBX_CF_META',assets:'PBX_CF_ASSETS'});
export const WORKER_NAME=NAMESPACE+'-worker';
export const WORKSPACE_NAME=NAMESPACE+'-workspace';
export const D1_ID='local:'+NAMESPACE+':meta';
export const DO_CLASS='PBXWorkspace';
export const OWNERSHIP=Object.freeze({schemaVersion:1,appId:APP_ID,namespace:NAMESPACE});
export const SAFETY_KEYS=Object.freeze(['REQUEST_BUDGET','READ_BUDGET','WRITE_BUDGET','SESSION_IDLE_MS','SESSION_ABSOLUTE_MS','QUOTA_PAUSED','D1_FAILURE']);

export function ownedIdentity(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='appId,namespace,schemaVersion'&&value.schemaVersion===1&&value.appId===APP_ID&&value.namespace===NAMESPACE;}

// Environment bindings are capabilities. A foreign or unknown capability is never ignored.
export function assertWorkerEnvironment(env){
 const allowed=new Set(['MODE','ORIGIN','PBX_CF_APP_ID','PBX_CF_NAMESPACE',...Object.values(BINDINGS),...SAFETY_KEYS]);
 if(!env||typeof env!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(env))||Reflect.ownKeys(env).some(key=>{const entry=Object.getOwnPropertyDescriptor(env,key);return typeof key!=='string'||!allowed.has(key)||!entry.enumerable||!Object.hasOwn(entry,'value');})||env.MODE!=='local'||env.PBX_CF_APP_ID!==APP_ID||env.PBX_CF_NAMESPACE!==NAMESPACE)throw new Error('Cloudflare app isolation rejected environment');
 if(typeof env.ORIGIN!=='string'||typeof env[BINDINGS.workspace]?.idFromName!=='function'||typeof env[BINDINGS.workspace]?.get!=='function'||typeof env[BINDINGS.metadata]?.prepare!=='function'||typeof env[BINDINGS.assets]?.fetch!=='function')throw new Error('Cloudflare app isolation rejected bindings');
}
