import {isAbsolute,resolve,sep} from 'node:path';
import {realpathSync,readFileSync} from 'node:fs';
import {keys,uuid} from './security.mjs';
export function stagingPolicy(value){
 if(!value)return {mode:'local',allowed:null,admin:null,origin:null,proxies:[]};
 keys(value,['mode','origin','allowedUserIds','adminUserId','releaseSHA','volumeRoot','trustedProxyAddresses','exposureApproved'],['mode','origin','allowedUserIds','adminUserId','releaseSHA','volumeRoot']);
 if(value.mode!=='private-staging')throw new Error('Only private staging configuration is supported');
 const url=new URL(value.origin);if(url.protocol!=='https:'||url.origin!==value.origin||url.username||url.password||url.hostname==='sai-messenger-production.up.railway.app')throw new Error('A canonical, separate HTTPS staging origin is required');
 if(!Array.isArray(value.allowedUserIds)||value.allowedUserIds.length<2||value.allowedUserIds.length>20)throw new Error('Explicit test-user allowlist required');
 const allowed=new Set(value.allowedUserIds.map(uuid));if(allowed.size!==value.allowedUserIds.length||!allowed.has(uuid(value.adminUserId)))throw new Error('Unique allowed users and a permitted operator are required');
 if(!/^[a-f0-9]{40}$/.test(value.releaseSHA)||!isAbsolute(value.volumeRoot))throw new Error('Pinned release and absolute persistent volume root required');
 const proxies=value.trustedProxyAddresses??[];if(!Array.isArray(proxies)||proxies.length>8||proxies.some(ip=>!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)||ip.split('.').some(n=>Number(n)>255)))throw new Error('Only exact reviewed proxy IPs are accepted');
 return {...value,allowed,admin:value.adminUserId,proxies};
}
export function verifyVolumePath(dbFile,volumeRoot){const root=realpathSync(volumeRoot),file=resolve(dbFile),compare=x=>process.platform==='win32'?x.toLowerCase():x;if(!compare(file).startsWith(compare(root)+sep))throw new Error('Database must be inside the explicit volume root');return root;}
export function verifyHostedMount(root,mountInfo){const mounts=mountInfo.split('\n').filter(Boolean).map(line=>{const [left,right]=line.split(' - ');return {path:left.split(' ')[4]?.replaceAll('\\040',' '),type:right?.split(' ')[0]};});if(!mounts.some(mount=>mount.path===root&&['ext4','xfs','btrfs','zfs'].includes(mount.type)))throw new Error('A dedicated persistent local filesystem mount is required; ephemeral/network storage refused');}
export function bindPolicy(host,policy,dbFile){if(host==='127.0.0.1'){if(policy.mode==='private-staging')verifyVolumePath(dbFile,policy.volumeRoot);return;}if(host!=='0.0.0.0'||policy.mode!=='private-staging'||policy.exposureApproved!==true)throw new Error('Only loopback is permitted until separate staging exposure approval');const root=verifyVolumePath(dbFile,policy.volumeRoot);verifyHostedMount(root,readFileSync('/proc/self/mountinfo','utf8'));}
export function requestOrigin(req,policy,port,aliases){const authority=req.headers.host;if(typeof authority!=='string'||req.rawHeaders.filter((_,index)=>index%2===0&&req.rawHeaders[index].toLowerCase()==='host').length!==1)throw new Error('Invalid Host');
 if(policy.mode==='local'){if(!aliases.some(alias=>authority===alias+':'+port))throw new Error('Invalid local Host');return 'http://'+authority;}
 if(authority!==new URL(policy.origin).host)throw new Error('Invalid staging Host');
 const peer=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');if(!req.socket.encrypted&&!(policy.proxies.includes(peer)&&req.headers['x-forwarded-proto']==='https'))throw new Error('Verified HTTPS transport required');return policy.origin;
}
