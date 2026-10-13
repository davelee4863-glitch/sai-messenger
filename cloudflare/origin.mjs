export const localHosts=['localhost','127.0.0.1','a.localhost','b.localhost','c.localhost'];
export function localOrigin(url,env){const configured=new URL(env.ORIGIN);return env.MODE==='local'&&localHosts.includes(url.hostname)&&localHosts.includes(configured.hostname)&&url.protocol===configured.protocol&&url.port===configured.port;}
