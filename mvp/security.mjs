import {randomBytes,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
const options={N:32768,r:8,p:1,maxmem:64*1024*1024};
export class Fault extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
export const fail=(status,code,message)=>{throw new Fault(status,code,message);};
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const token=()=>randomBytes(32).toString('hex');
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
export async function passwordHash(password,salt=randomBytes(16).toString('hex')) {
 if(typeof password!=='string'||password.length<12||password.length>128)fail(422,'INVALID_PASSWORD','비밀번호 길이를 확인해주세요.');
 return {salt,hash:(await derive(password,salt,32,options)).toString('hex')};
}
export async function passwordMatches(password,record) {
 const safe=typeof password==='string'&&password.length<=128?password:'invalid';
 const hash=(await derive(safe,record?.salt||'00000000000000000000000000000000',32,options)).toString('hex');
 return Boolean(record)&&equal(hash,record.password_hash);
}
export function keys(body,allowed,required=allowed) {
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(body,key)))fail(422,'INVALID_FIELDS','요청 항목을 확인해주세요.');
}
export function text(value,max,label,{empty=false}={}) {
 if(typeof value!=='string'||(!empty&&!value.trim())||[...value].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail(422,'INVALID_TEXT',label+'을 확인해주세요.');
 return value.trim();
}
export function uuid(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))fail(422,'INVALID_ID','소문자 UUID 형식을 확인해주세요.');return value;}
export function version(value){if(!Number.isSafeInteger(value)||value<1)fail(422,'INVALID_VERSION','확인한 버전을 보내주세요.');return value;}
export function appointment(body) {
 keys(body,['title','date','time','endTime','place','notes']);
 const result={title:text(body.title,80,'약속 이름'),date:body.date,time:body.time,endTime:body.endTime,place:text(body.place,200,'장소'),notes:text(body.notes,2000,'메모',{empty:true})};
 if(typeof body.date!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(body.date)||Number.isNaN(Date.parse(body.date+'T00:00:00Z'))||new Date(body.date+'T00:00:00Z').toISOString().slice(0,10)!==body.date)fail(422,'INVALID_DATE','실제 날짜를 입력해주세요.');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)||typeof body.time!=='string'||typeof body.endTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.endTime)||body.endTime<=body.time)fail(422,'INVALID_TIME','종료 시간은 시작 시간 이후로 입력해주세요.');
 return result;
}
export class Limiter {
 constructor({now=Date.now,maxEntries=1000}={}){this.now=now;this.maxEntries=maxEntries;this.buckets=new Map();}
 take(key,limit,windowMs=60000){const now=this.now();for(const [key,bucket] of this.buckets)if(bucket.until<=now)this.buckets.delete(key);let bucket=this.buckets.get(key);if(!bucket){if(this.buckets.size>=this.maxEntries)fail(429,'RATE_LIMIT','잠시 후 다시 시도해주세요.');bucket={used:0,until:now+windowMs};this.buckets.set(key,bucket);}if(++bucket.used>limit)fail(429,'RATE_LIMIT','요청이 많아요. 잠시 후 다시 시도해주세요.');}
}
