import {act,active,addPlayer,addLog,cleanup,leave,newPlayer,newRoom,startHand,tick,view,type Room,type Player} from '@/lib/poker';
import {hashToken,insertRoom,readRoom,writeRoom} from '@/lib/room-store';

const headers={'Cache-Control':'no-store, private','Pragma':'no-cache'};
function nameOf(x:unknown){
  if(typeof x!=='string')throw new Error('请输入昵称。');
  const name=x.trim();
  if(!name||name.length>12||/[\x00-\x1f<>]/.test(name))throw new Error('昵称需为 1–12 个字。');
  return name;
}
function codeOf(x:unknown){
  if(typeof x!=='string'||!/^[A-Z2-9]{6}$/.test(x))throw new Error('请输入六位房间码。');
  return x;
}
function code(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',a=crypto.getRandomValues(new Uint8Array(6));
  return Array.from(a,x=>chars[x%chars.length]).join('');
}
function applyCommand(r:Room,p:Player,body:Record<string,unknown>,now:number){
  if(body.op==='ready'){
    if(active(r))throw new Error('牌局中不能改变准备状态。');
    if(p.stack<=0)throw new Error('筹码用完了，请等待房主重置牌桌。');
    p.ready=!p.ready;p.seen=now;
  }else if(body.op==='start'){
    if(r.host!==p.id)throw new Error('只有房主能开始牌局。');
    startHand(r,now);
  }else if(body.op==='action'){
    if(body.hand!==r.hand||body.turn!==r.turn)throw new Error('牌局已更新，请重新选择。');
    act(r,p.id,String(body.kind),typeof body.amount==='number'?body.amount:undefined,now);
  }else if(body.op==='leave')leave(r,p.id,now);
  else if(body.op==='reset'){
    if(r.host!==p.id||active(r))throw new Error('房主可在本手结束后重置筹码。');
    for(const q of r.players){q.stack=1000;q.ready=q.bot;q.inHand=false;q.cards=[];q.label='等待准备';q.won=0}
    r.phase=-1;r.board=[];r.pots=[];addLog(r,'房主重置了牌桌筹码。');
  }else throw new Error('未知操作。');
}
async function handle(req:Request,body:Record<string,unknown>){
  const token=req.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
  if(!/^[a-f0-9]{64}$/.test(token))throw new Error('会话失效，请重新入座。');
  const secret=await hashToken(token),op=body.op;
  if(op==='create'){
    const p=newPlayer(crypto.randomUUID(),nameOf(body.name),secret),r=newRoom(code(),p);
    await insertRoom(r);return view(r,p.id);
  }
  const roomCode=codeOf(body.code);
  const isCommand=op!=='poll'&&op!=='join';
  const requestId=typeof body.requestId==='string'?body.requestId:'';
  if(isCommand&&(!requestId||requestId.length>80))throw new Error('请求无效，请重试。');
  for(let tries=0;tries<5;tries++){
    const{room:r,revision}=await readRoom(roomCode);
    let dirty=false,p=r.players.find(p=>p.secret===secret);
    if(p?.leaving)throw new Error('会话失效，请重新入座。');
    if(op==='join'){
      if(!p){cleanup(r);p=newPlayer(crypto.randomUUID(),nameOf(body.name),secret);addPlayer(r,p);dirty=true}
    }else if(!p)throw new Error('会话失效，请重新入座。');
    if(!p)throw new Error('无法加入房间。');
    const now=Date.now();
    if(now-p.seen>10000){p.seen=now;dirty=true}
    if(tick(r,now))dirty=true;
    if(isCommand&&!r.lastRequest.includes(requestId)){
      // Keep authoritative timeout/host changes even when a late action is rejected.
      // A failed command itself must never persist partial changes.
      const maintenance=dirty?structuredClone(r):null;
      try{applyCommand(r,p,body,now)}
      catch(error){
        if(maintenance&&!(await writeRoom(maintenance,revision)))continue;
        throw error;
      }
      r.lastRequest.push(requestId);r.lastRequest=r.lastRequest.slice(-48);dirty=true;
    }
    if(!dirty||await writeRoom(r,revision))return view(r,p.id);
  }
  throw new Error('牌桌正在更新，请重试。');
}
export async function POST(req:Request){
  try{
    const origin=req.headers.get('Origin');
    if(origin&&origin!==new URL(req.url).origin)return Response.json({error:'请求来源不符。'},{status:403,headers});
    const text=await req.text();
    if(text.length>4096)return Response.json({error:'请求过大。'},{status:413,headers});
    let body:unknown;
    try{body=JSON.parse(text)}catch{throw new Error('请求格式无效，请使用 JSON。')}
    if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('请求无效。');
    const room=await handle(req,body as Record<string,unknown>);
    return Response.json({room},{headers});
  }catch(error){
    const message=error instanceof Error?error.message:'牌桌暂时无法连接。';
    const safe=/^(请输入|昵称|房间|牌局|牌桌正在|会话|还没|需要|当前|加注|未知|筹码|至少|请等待|只有|房主|本手|这个昵称|无法加入|请求)/.test(message);
    if(!safe)console.error('Poker API:',message);
    return Response.json({error:safe?message:'牌桌服务暂时不可用，请稍后重试。'},{status:safe?400:503,headers});
  }
}
