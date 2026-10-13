import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LOCAL_PLAN,KINDS,validateIsolation} from './cloudflare-isolation.mjs';
const now=Date.parse('2026-10-14T00:00:00.000Z');
function fixture() {
  const data=JSON.parse(readFileSync(new URL('../cloudflare/isolation-inventory.example.json',import.meta.url)));
  data.capturedAt=new Date(now).toISOString();return data;
}
const check=data=>validateIsolation(LOCAL_PLAN,data,{now});
function deny(data,pattern=/ISOLATION_INVENTORY_/) { const errors=check(data);assert.ok(errors.some(error=>pattern.test(error)),JSON.stringify(errors)); }
test('policy: unknown permission resource scope must block complete inventory validation',()=>{const data=fixture();delete data.resources.permissions[0].targetIds;deny(data,/PERMISSION_SCOPE/);});
test('policy: omitted protected resource relationships must block complete inventory validation',()=>{const data=fixture();for(const kind of ['durableObjects','migrations','backups','logs','routes','domains'])data.resources[kind]=data.resources[kind].map(({id,name,owner,namespace})=>({id,name,owner,namespace}));deny(data,/RELATION_MISSING/);});
test('control: explicitly incomplete inventory is blocked',()=>{const data=fixture();data.categoriesComplete.permissions=false;deny(data,/INCOMPLETE/);});
test('control: explicit wildcard permission scope is blocked',()=>{const data=fixture();data.resources.permissions[0].targetIds=['*'];deny(data);});
test('control: synthetic and claimed read-only inventories cannot authorize deployment',()=>{for(const source of ['synthetic','read-only-export']){const data=fixture();data.source=source;assert.ok(validateIsolation(LOCAL_PLAN,data,{now,mode:'deployment'}).includes('LIVE_RESOURCE_IDENTITIES_NOT_ATTESTED'));}});
test('complete synthetic resource relationships pass local metadata checks only',()=>assert.deepEqual(check(fixture()),[]));
for(const field of ['scope','role','principalId','targetIds'])test('missing permission '+field+' is rejected',()=>{const data=fixture();delete data.resources.permissions[0][field];deny(data,/PERMISSION_SCOPE/);});
for(const scope of ['account','product','app','*','UNKNOWN'])test('broad or unknown scope '+scope+' is rejected',()=>{const data=fixture();data.resources.permissions[0].scope=scope;deny(data,/PERMISSION_SCOPE/);});
test('permission duplicates, empty targets, wildcards, unknown roles and unknown target IDs block',()=>{
 for(const change of [row=>row.targetIds=[],row=>row.targetIds.push(row.targetIds[0]),row=>row.targetIds=['missing-id'],row=>row.role='deployer',row=>row.principalId='UNVERIFIED']){const data=fixture();change(data.resources.permissions[0]);deny(data);}
 const duplicate=fixture();duplicate.resources.permissions.push(structuredClone(duplicate.resources.permissions[0]));deny(duplicate,/DUPLICATE/);
});
test('permission target IDs cannot cross app ownership or namespace even when known',()=>{for(const field of ['owner','namespace']){const data=fixture();data.resources.d1[0][field]='another-app';deny(data,/REFERENCE_FOREIGN/);}});
test('a principal with individually scoped roles cannot mix two apps',()=>{
 const data=fixture(),rows=structuredClone(LOCAL_PLAN.resources);for(const kind of KINDS)data.resources[kind].push(...rows[kind]);
 data.resources.permissions.push({id:'local-owned-permission',name:'owned-editor',owner:LOCAL_PLAN.appId,namespace:LOCAL_PLAN.namespace,scope:'resource',role:'editor',principalId:data.resources.permissions[0].principalId,targetIds:[LOCAL_PLAN.resources.workers[0].id]});
 deny(data,/PERMISSION_MIXED_PRINCIPAL/);
});
for(const kind of ['workers','d1','r2','kv','queues','durableObjects','secrets','environmentVariables','routes','domains','backups','logs','migrations'])test('missing mandatory '+kind+' relationship blocks',()=>{
 const data=fixture(),row=data.resources[kind][0];delete row[kind==='workers'?'targetIds':['d1','r2','kv','queues'].includes(kind)?'workerIds':['backups','logs','migrations'].includes(kind)?'targetId':'workerId'];deny(data,/RELATION_MISSING|SCOPE_MISSING/);
});
test('explicit verified unbound storage is distinguished from a missing relation',()=>{
 const data=fixture(),row=data.resources.r2[0];row.workerIds=[];delete row.binding;data.resources.workers[0].targetIds=data.resources.workers[0].targetIds.filter(id=>id!==row.id);assert.deepEqual(check(data),[]);
});
test('forward-only or reverse-only binding relationships block',()=>{
 for(const change of [data=>data.resources.workers[0].targetIds=[],data=>data.resources.d1[0].workerIds=[]]){const data=fixture();change(data);deny(data,/RELATION_MISMATCH|RELATION_MISSING/);}
});
test('known wrong-kind targets and mismatched DO implementer script block',()=>{
 for(const change of [data=>data.resources.logs[0].targetId=data.resources.permissions[0].id,data=>data.resources.migrations[0].targetId=data.resources.workers[0].id,data=>data.resources.durableObjects[0].scriptName='missing-script']){const data=fixture();change(data);deny(data);}
});
test('binding alias collisions within a Worker block',()=>{const data=fixture();data.resources.r2[0].binding=data.resources.d1[0].binding;deny(data,/BINDING_COLLISION/);});
test('cross-app worker bindings, secrets and route targets block without accessing a target',()=>{for(const kind of ['workers','durableObjects','d1','r2','kv','queues','secrets','environmentVariables','routes','domains','backups','logs','migrations']){const data=fixture();data.resources[kind][0].owner='another-app';deny(data,/REFERENCE_FOREIGN/);}});
test('null and malformed inventory is rejected without throwing during policy accumulation',()=>{for(const data of [null,undefined,{},[],{resources:null}]){let errors;assert.doesNotThrow(()=>errors=check(data));assert.ok(errors.length);}});
