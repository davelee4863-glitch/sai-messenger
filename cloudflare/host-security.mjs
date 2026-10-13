// Host emulator only; never imported into the Worker graph. No filesystem/network work.
export function assertHostRuntime({node=process.versions.node,undici=process.versions.undici}={}){
 const version=value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value)?value.split('.').map(Number):null;
 const atLeast=(actual,minimum)=>{for(let i=0;i<3;i++)if(actual[i]!==minimum[i])return actual[i]>minimum[i];return true;};
 const n=version(node),u=version(undici),floor={'6':[6,28,1],'7':[7,29,1],'8':[8,10,2]}[u?.[0]];
 if(!n||n[0]!==22||!atLeast(n,[22,23,3])||!u||!floor||!atLeast(u,floor))throw Error('Unsupported local host runtime: require Node22.23.3+ within22.x and a reviewed patched embedded Undici');
}
