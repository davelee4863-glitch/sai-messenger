import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPromiseClients} from './browser-regression.mjs';
// These are Node counterexamples for the assertion helper, not browser execution.
const adapter=buttons=>({playwright:{domSnapshot:async()=>'',evaluate:async()=>({title:'合成',attendees:[{id:'host',response:'pending'},{id:'guest',response:'going'}],buttons})}});
const choices=selected=>['나는 참석','나는 미정','나는 불참'].map(text=>({text,pressed:text===selected?'true':'false'}));
test('browser assertion rejects a wrong selected RSVP label even when pill and count look correct',async()=>{await assert.rejects(verifyPromiseClients([{tab:adapter(choices('나는 불참')),userId:'guest'}],{host:'pending',guest:'going'},'host'),/RSVP/);});
test('browser assertion accepts only the exact own selection matching the status',async()=>{assert.equal((await verifyPromiseClients([{tab:adapter(choices('나는 참석')),userId:'guest'}],{host:'pending',guest:'going'},'host')).status,'PASS');});
test('browser assertion rejects missing or mixed own RSVP controls',async()=>{await assert.rejects(verifyPromiseClients([{tab:adapter([{text:'나는 참석',pressed:'true'}]),userId:'guest'}],{host:'pending',guest:'going'},'host'),/RSVP/);});
