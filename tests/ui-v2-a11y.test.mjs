import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Execute the real modal helper with a small DOM double. Physical browser and
// screen-reader observations remain separate; these tests do not emulate them.
const source=readFileSync(new URL('../preview-v2/app.mjs',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('function openDialog('),source.indexOf('function proposalEdit('));
function setup() {
 const document={activeElement:null,body:{append(node){node.isConnected=true;}}};
 class Node {
  constructor(tag,attrs={},children=[]) {this.tagName=tag.toUpperCase();this.attrs=attrs;this.children=children.flat(Infinity).filter(n=>n instanceof Node);this.hidden=false;this.disabled=false;this.inert=false;this.visible=true;this.tabIndex=['BUTTON','INPUT','TEXTAREA','SELECT','A'].includes(this.tagName)?0:-1;this.isConnected=true;this.events={};for(const child of this.children)child.parent=this;}
  addEventListener(name,fn){this.events[name]=fn;}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  querySelectorAll(){const all=[];const visit=n=>{for(const child of n.children){if(['BUTTON','INPUT','TEXTAREA','SELECT','A'].includes(child.tagName)||child.attrs.tabindex!==undefined)all.push(child);visit(child);}};visit(this);return all.filter(n=>!n.disabled&&n.attrs.type!=='hidden');}
  closest(){for(let n=this;n;n=n.parent)if(n.hidden||n.inert)return n;return null;}
  getClientRects(){return this.visible?[{width:44,height:44}]:[];}
  focus(){document.activeElement=this;}
  showModal(){this.open=true;this.querySelectorAll()[0]?.focus();}
  close(){this.open=false;this.events.close?.();}
  remove(){this.isConnected=false;}
 }
 const h=(tag,attrs,...children)=>new Node(tag,attrs,children);
 const btn=(label,onclick,style,name)=>h('button',{'aria-label':name,onclick},label);
 const previous=h('button',{},'open');previous.focus();
 const firstInput=h('input',{}),last=h('button',{},'submit');
 const dialog=runInNewContext(helper+'\nopenDialog("test",content)',{document,h,btn,icon:()=>'',content:h('div',{},firstInput,last)});
 const first=dialog.querySelectorAll()[0];
 const key=(target,shiftKey=false,extra={})=>{target.focus();const event={key:'Tab',shiftKey,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra};dialog.events.keydown?.(event);return event;};
 return {document,dialog,first,firstInput,last,previous,key,h};
}
test('A11y: opening gives initial focus to the labelled close button',()=>{const s=setup();assert.equal(s.document.activeElement,s.first);assert.equal(s.first.attrs['aria-label'],'닫기');});
test('A11y: Tab at the last control wraps to the first without leaving modal',()=>{const s=setup(),e=s.key(s.last);assert.equal(e.defaultPrevented,true);assert.equal(s.document.activeElement,s.first);});
test('A11y: Shift+Tab at the first control wraps to the last',()=>{const s=setup(),e=s.key(s.first,true);assert.equal(e.defaultPrevented,true);assert.equal(s.document.activeElement,s.last);});
test('A11y: interior forward and reverse Tab remain native',()=>{const s=setup();assert.equal(s.key(s.firstInput).defaultPrevented,false);assert.equal(s.key(s.firstInput,true).defaultPrevented,false);});
test('A11y: Escape and browser shortcuts are not intercepted by Tab handler',()=>{const s=setup();for(const extra of [{key:'Escape'},{key:'Enter'},{ctrlKey:true},{metaKey:true},{altKey:true},{defaultPrevented:true}])assert.equal(s.key(s.last,false,extra).defaultPrevented,!!extra.defaultPrevented);});
test('A11y: controls disabled after opening are excluded from the boundary',()=>{const s=setup();s.last.disabled=true;const e=s.key(s.firstInput);assert.equal(e.defaultPrevented,true);assert.equal(s.document.activeElement,s.first);});
test('A11y: hidden, inert, negative-tabindex and non-rendered controls are excluded',()=>{for(const omit of [n=>n.hidden=true,n=>n.inert=true,n=>n.tabIndex=-1,n=>n.visible=false]){const s=setup();omit(s.last);assert.equal(s.key(s.firstInput).defaultPrevented,true);assert.equal(s.document.activeElement,s.first);}});
test('A11y: one available control holds focus in both directions',()=>{const s=setup();s.firstInput.disabled=true;s.last.disabled=true;for(const reverse of [false,true]){assert.equal(s.key(s.first,reverse).defaultPrevented,true);assert.equal(s.document.activeElement,s.first);}});
test('A11y: a focusless modal has an explicit dialog fallback',()=>{const s=setup();s.first.disabled=true;s.firstInput.disabled=true;s.last.disabled=true;assert.equal(s.key(s.dialog).defaultPrevented,true);assert.equal(s.document.activeElement,s.dialog);});
test('A11y: focus displaced to the dialog or outside returns to a boundary',()=>{for(const outside of [false,true])for(const reverse of [false,true]){const s=setup();assert.equal(s.key(outside?s.previous:s.dialog,reverse).defaultPrevented,true);assert.equal(s.document.activeElement,reverse?s.last:s.first);}});
test('A11y: ordinary close removes modal and restores its opener',()=>{const s=setup();s.dialog.close();assert.equal(s.dialog.isConnected,false);assert.equal(s.document.activeElement,s.previous);});
test('A11y: detached opener is never focused after close',()=>{const s=setup();s.previous.isConnected=false;s.previous.focus=()=>assert.fail('detached opener focused');assert.doesNotThrow(()=>s.dialog.close());});
function renderFocus(disabled,missing=false){
 const start=source.lastIndexOf(' if(identity) {'),block=source.slice(start,source.indexOf('\n}\nwindow.addEventListener',start));
 let active='BODY';const control={tagName:'BUTTON',id:'confirm',disabled,focus(){if(!this.disabled)active='control';}},heading={focus(){active='heading';}};
 runInNewContext(block,{identity:{tag:'BUTTON',id:'confirm'},controls:'button,input,textarea,select',main:{querySelectorAll:()=>missing?[]:[control]},$:()=>heading});return active;
}
test('A11y: newly disabled action restores focus to the current page heading',()=>assert.equal(renderFocus(true),'heading'));
test('A11y: still-enabled replacement action retains its own focus',()=>assert.equal(renderFocus(false),'control'));
test('A11y: missing replacement retains the existing heading fallback',()=>assert.equal(renderFocus(false,true),'heading'));
