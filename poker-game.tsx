"use client";
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Slider} from '@/components/ui/slider';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle,AlertDialogTrigger} from '@/components/ui/alert-dialog';
import {act,active,addPlayer,botMove,newPlayer,newRoom,startHand,tick,view,PHASES,type Room,type RoomView,type Card} from '@/lib/poker';
import {sendRequest,readSession,readStorage,writeStorage,PokerRequestError,type Session} from '@/lib/poker-client';
const fmt=(x:number)=>x.toLocaleString('zh-CN');
const suits:Record<string,string>={S:'♠',H:'♥',D:'♦',C:'♣'};
function PlayingCard({card,back=false,empty=false}:{card?:Card|null;back?:boolean;empty?:boolean}){if(empty)return <span className="playing-card empty" aria-label="未发牌"/>;if(back||!card)return <span className="playing-card back" aria-label="隐藏底牌">✦</span>;const rank=card.rank===14?'A':card.rank===13?'K':card.rank===12?'Q':card.rank===11?'J':card.rank;return <span className={`playing-card ${'HD'.includes(card.suit)?'red':'black'}`} aria-label={`${rank}${suits[card.suit]}`}><b>{rank}</b><i>{suits[card.suit]}</i></span>}
export default function PokerGame(){
  const[screen,setScreen]=useState<'home'|'online'|'solo'|'reconnect'|'table'>('home'),[nick,setNick]=useState(''),[joinCode,setJoinCode]=useState(''),[opponents,setOpponents]=useState('3'),[room,setRoom]=useState<RoomView|null>(null),[session,setSession]=useState<Session|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[connected,setConnected]=useState(true),[connectionError,setConnectionError]=useState(''),[raiseTo,setRaiseTo]=useState(40),[clock,setClock]=useState(Date.now()),[copied,setCopied]=useState(false),[hydrated,setHydrated]=useState(false);
  const local=useRef<Room|null>(null),sessionRef=useRef<Session|null>(null),roomRef=useRef<RoomView|null>(null),busyRef=useRef(false),sequence=useRef(0),applied=useRef(0),generation=useRef(0),offset=useRef(0);
  function accept(r:RoomView){roomRef.current=r;offset.current=r.serverTime-Date.now();setRoom(r)}
  async function request(op:string,extra:Record<string,unknown>={},auth=sessionRef.current){
    if(!auth)throw new Error('请先入座。');
    const n=++sequence.current,g=generation.current;
    const result=await sendRequest(auth,op,extra);
    if(g===generation.current&&n>=applied.current){applied.current=n;accept(result);setConnected(true);setConnectionError('')}
    return result;
  }
  function remember(s:Session|null){sessionRef.current=s;setSession(s);writeStorage('last-hand-session',s?JSON.stringify(s):null,true)}
  function endSession(message=''){
    generation.current++;local.current=null;remember(null);setRoom(null);roomRef.current=null;setScreen('home');setError(message);setConnectionError('');setConnected(true);history.replaceState({},'','/');
  }
  function reportFailure(error:unknown){
    if(error instanceof PokerRequestError&&error.sessionLost){endSession(error.message);return}
    if(error instanceof PokerRequestError&&error.temporary){setConnected(false);setConnectionError(error.message);return}
    setError(error instanceof Error?error.message:'操作失败，请重试。');
  }
  useEffect(()=>{
    setNick(readStorage('last-hand-nickname')||'');
    const code=new URLSearchParams(location.search).get('room');
    if(code){setJoinCode(code.toUpperCase().slice(0,6));setScreen('online')}
    const saved=readSession();
    if(saved){remember(saved);setScreen('reconnect')}
    setHydrated(true);
  },[]);
  useEffect(()=>{
    if(!session||(screen!=='table'&&screen!=='reconnect')||local.current)return;
    let stop=false;let timer:ReturnType<typeof setTimeout>;
    const g=generation.current;
    async function poll(){
      if(stop)return;
      try{if(!busyRef.current){await request('poll');if(!stop&&g===generation.current&&screen==='reconnect')setScreen('table')}}
      catch(e){if(!stop&&g===generation.current)reportFailure(e)}
      if(!stop&&g===generation.current)timer=setTimeout(poll,1000);
    }
    timer=setTimeout(poll,screen==='reconnect'?0:1000);
    return()=>{stop=true;clearTimeout(timer)};
  },[session,screen]);
  useEffect(()=>{const t=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(t)},[]);
  useEffect(()=>{
    const r=local.current;if(!r||!active(r))return;
    const p=r.players.find(p=>p.seat===r.actor);if(!p?.bot)return;
    const t=setTimeout(()=>{if(local.current!==r)return;touchLocal(r);botMove(r);accept(view(r,'you'))},650);
    return()=>clearTimeout(t);
  },[room?.turn,room?.hand,screen]);
  function touchLocal(r:Room){const p=r.players.find(p=>p.id==='you');if(p)p.seen=Date.now()}
  useEffect(()=>{const r=local.current;if(r){touchLocal(r);if(active(r)&&tick(r,Date.now()))accept(view(r,'you'))}},[clock]);
  useEffect(()=>{if(room?.options)setRaiseTo(room.options.min)},[room?.turn,room?.options?.min]);
  function validName(){const n=nick.trim();if(!n||n.length>12||/[\x00-\x1f<>]/.test(n)){setError('请先输入 1–12 个字的昵称，不能含控制字符或尖括号。');return null}writeStorage('last-hand-nickname',n);setNick(n);setError('');return n}
  function choose(mode:'online'|'solo'){if(!busyRef.current&&validName())setScreen(mode)}
  async function enter(op:'create'|'join'){
    const name=validName();if(!name||busyRef.current)return;
    if(op==='join'&&!/^[A-Z2-9]{6}$/.test(joinCode)){setError('请输入六位房间码。');return}
    busyRef.current=true;setBusy(true);setConnectionError('');
    const token=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const auth={code:joinCode,token};
    try{const r=await request(op,{name},auth);local.current=null;remember({code:r.code,token});setScreen('table');setError('')}
    catch(e){setError(e instanceof Error?e.message:'无法入座，请重试。')}
    finally{busyRef.current=false;setBusy(false)}
  }
  function startSolo(){
    if(busyRef.current)return;const name=validName();if(!name)return;
    generation.current++;remember(null);setConnectionError('');setConnected(true);
    const p=newPlayer('you',name);p.ready=true;const r=newRoom('SOLO',p);
    for(let i=0;i<Number(opponents);i++)addPlayer(r,newPlayer(`bot${i}`,(['老牌客','小方','阿七','冷面','好运来'][i]===name?'电脑 '+(i+1):['老牌客','小方','阿七','冷面','好运来'][i]),'',true));
    startHand(r);local.current=r;accept(view(r,'you'));setScreen('table');setError('');
  }
  async function command(op:string,extra:Record<string,unknown>={}):Promise<boolean>{
    if(busyRef.current)return false;setError('');const r=local.current;
    if(r){
      try{
        touchLocal(r);
        if(op==='action')act(r,'you',String(extra.kind),typeof extra.amount==='number'?extra.amount:undefined);
        if(op==='start'){r.players.find(p=>p.id==='you')!.ready=true;startHand(r)}
        if(op==='reset'){for(const p of r.players){p.stack=1000;p.ready=true;p.cards=[];p.inHand=false;p.label='等待开局';p.won=0}r.phase=-1;r.board=[];r.pots=[]}
        accept(view(r,'you'));return true;
      }catch(e){reportFailure(e);return false}
    }
    busyRef.current=true;setBusy(true);
    try{await request(op,extra);setError('');return true}
    catch(e){reportFailure(e);return false}
    finally{busyRef.current=false;setBusy(false)}
  }
  async function leaveTable(){if(!local.current&&!(await command('leave')))return;endSession()}
  async function copyInvite(){try{await navigator.clipboard.writeText(`${location.origin}/?room=${room!.code}`);setCopied(true);setTimeout(()=>setCopied(false),2000)}catch{setError(`请复制房间码：${room!.code}`)}}
  useEffect(()=>{const mc=(document as Document&{modelContext?:{registerTool:(t:unknown,o:unknown)=>void}}).modelContext;if(!mc)return;const controller=new AbortController();try{mc.registerTool({name:'read_poker_table',description:'查看当前牌桌、你的底牌和当前合法行动；不会显示对手隐藏底牌。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:(input:unknown)=>{if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('此操作不接受参数。');return roomRef.current||{screen:'home'}}},{signal:controller.signal})}catch{}return()=>controller.abort()},[]);
  const me=room?.players.find(p=>p.id===room.me),playing=room?room.phase>=0&&room.phase<4:false,myTurn=playing&&room?.actor===me?.seat,o=room?.options,remaining=Math.min(30,Math.max(0,Math.ceil(((room?.deadline||0)-(clock+offset.current))/1000))),solo=!!local.current;
  const unavailable=busy||(!solo&&!connected);
  const readyPlayers=room?.players.filter(p=>p.stack>0&&!p.leaving&&p.online)||[],allReady=readyPlayers.length>=2&&readyPlayers.every(p=>p.ready&&p.online),isHost=room?.host===room?.me;
  const slots=Array.from({length:6},(_,i)=>room?.players.find(p=>(p.seat-(me?.seat||0)+6)%6===i));
  const sendAction=(kind:string,amount?:number)=>command('action',{kind,amount,hand:room?.hand,turn:room?.turn});
  return <main className={`home ${screen==='table'?'game-home':''}`}><header className="mast"><button className="wordmark" onClick={()=>{if(!busy&&screen!=='table'&&screen!=='reconnect')setScreen('home')}}>♠ 最后一手</button><div className="head-right">{screen==='table'?<><span className="meta">{solo?'单机练习':`房间 ${room?.code}`} · {room?.players.length}/6</span><AlertDialog><AlertDialogTrigger asChild><Button variant="outline">离开牌桌</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>离开这张牌桌？</AlertDialogTitle><AlertDialogDescription>{playing?'未全下的手牌将弃牌。本桌筹码不会带到其他房间。':'之后可通过房间码重新加入。'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>继续玩</AlertDialogCancel><AlertDialogAction onClick={leaveTable}>离开</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>:<span className="meta">TEXAS HOLD’EM · 虚拟筹码</span>}</div></header>
    {(error||connectionError)&&<div className="error-banner" role="alert">{error||connectionError}<button onClick={()=>{setError('');setConnectionError('')}} aria-label="关闭提示">×</button></div>}
    {screen==='reconnect'&&<section className="start"><div className="start-title"><h1>正在回到牌桌</h1><p>正在恢复房间 {session?.code}，原座位已保留。连接恢复后会自动入座。</p></div><Button variant="outline" onClick={()=>endSession()}>放弃重连并返回首页</Button></section>}
    {screen==='home'&&<section className="start"><div className="start-title"><span className="kicker">好友入座，好戏开场</span><h1>这手，跟不跟？</h1><p>和朋友同桌，或独自练一手。</p></div><div className="menu"><label htmlFor="nick">你的牌桌昵称</label><Input id="nick" disabled={!hydrated} value={nick} onChange={e=>setNick(e.target.value)} placeholder="输入昵称" maxLength={12}/><div className="mode-grid"><Button className="mode multiplayer" disabled={!hydrated} onClick={()=>choose('online')}><span>♣</span><strong>多人对局</strong><small>创建房间或通过房间码加入 · 2–6 人</small></Button><Button className="mode solo" disabled={!hydrated} onClick={()=>choose('solo')}><span>♠</span><strong>单机练习</strong><small>和 1–5 位电脑玩家切磋牌技</small></Button></div><p className="menu-note">每人 1,000 筹码 · 盲注 10 / 20</p></div></section>}
    {screen==='online'&&<section className="start"><Button variant="ghost" disabled={busy} onClick={()=>setScreen('home')}>返回主界面</Button><div className="start-title"><h1>邀请朋友入座</h1><p>创建一张牌桌，把邀请链接发给朋友。</p></div><div className="menu"><label htmlFor="online-nick">你的昵称</label><Input id="online-nick" maxLength={12} value={nick} onChange={e=>setNick(e.target.value)} placeholder="输入昵称"/><Button className="create-room" disabled={busy} onClick={()=>enter('create')}>{busy?'正在入座…':'创建六人房间'}</Button><div className="or-divider">或加入朋友的牌桌</div><label htmlFor="room-code">六位房间码</label><div className="join-row"><Input id="room-code" value={joinCode} maxLength={6} onChange={e=>setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g,''))} placeholder="例如 ABC234" autoCapitalize="characters"/><Button disabled={busy} onClick={()=>enter('join')}>加入房间</Button></div><p className="menu-note">2 人即可开始，最多 6 人。开局后，新玩家需等本手结束再加入。</p></div></section>}
    {screen==='solo'&&<section className="start"><Button variant="ghost" disabled={busy} onClick={()=>setScreen('home')}>返回主界面</Button><div className="start-title"><h1>练一手</h1><p>选好对手数量，随时开局。</p></div><div className="menu"><label htmlFor="solo-nick">你的昵称</label><Input id="solo-nick" value={nick} onChange={e=>setNick(e.target.value)} maxLength={12}/><h2 className="small-heading">电脑玩家数量</h2><RadioGroup value={opponents} onValueChange={setOpponents} className="opponent-picker" aria-label="电脑玩家数量">{['1','2','3','4','5'].map(n=><label key={n} className={n===opponents?'selected':''}><RadioGroupItem value={n} id={`bot-${n}`}/><span>{n} 位</span></label>)}</RadioGroup><Button className="create-room" onClick={startSolo}>开始单机对局</Button></div></section>}
    {screen==='table'&&room&&<section className="game-layout"><div className="table-column"><div className="table-toolbar"><span>{solo?'单机练习':connected?'在线牌桌':'正在重连…'} · 第 {room.hand} 手</span><span>盲注 10 / 20</span>{!solo&&<Button variant="ghost" size="sm" onClick={copyInvite}>{copied?'链接已复制':'复制邀请链接'}</Button>}</div><div className="poker-table"><div className="felt"/><div className="table-center">{room.phase===-1?<><div className="center-eyebrow">等待入座</div><strong className="room-code">{room.code==='SOLO'?'准备好了':room.code}</strong><span className="table-sub">{room.players.length}/6 位玩家 · {readyPlayers.filter(p=>p.ready).length} 位已准备</span></>:<><div className="center-eyebrow">{room.phase===4?'本手结束':PHASES[room.phase]}</div><strong className="table-pot">{fmt(room.pot)}<small>底池</small></strong><div className="board-cards">{Array.from({length:5},(_,i)=><PlayingCard key={i} card={room.board[i]} empty={!room.board[i]}/>)}</div></>}{playing&&<div className="table-sub">{myTurn?'轮到你':`${room.players.find(p=>p.seat===room.actor)?.name||'玩家'}行动中`} · {remaining}s</div>}{room.phase===4&&<div className="table-result">{room.players.filter(p=>p.won>0).map(p=>`${p.name} +${fmt(p.won)}`).join(' · ')}</div>}</div>
    {slots.map((p,pos)=><div className={`seat position-${pos} ${p&&room.actor===p.seat&&playing?'acting':''} ${p?.folded?'folded':''}`} key={pos}>{p?<><div className="seat-name"><span>{p.name}{p.id===room.me?' · 你':''}</span>{p.seat===room.dealer&&room.hand>0&&<b className="dealer-tag">D</b>}</div><div className="seat-stack">{fmt(p.stack)}</div><div className="hole-cards">{p.cards.length?p.cards.map((c,i)=><PlayingCard key={i} card={c} back={!c}/>):<span className="lobby-status">{p.stack<=0?'筹码用完':p.ready?'已准备':'未准备'}</span>}</div><div className="seat-status">{!p.online?'离线':playing?p.label:p.won?`赢得 ${fmt(p.won)}`:p.ready?'已准备':'等待准备'}{playing&&p.bet>0?` · ${p.bet}`:''}</div></>:<><span className="empty-seat-icon">＋</span><span className="empty-seat-text">空位</span></>}</div>)}
    </div><div className="action-box">{playing?<><div className="action-label"><strong>{myTurn?'轮到你下注':`等待${room.players.find(p=>p.seat===room.actor)?.name||'玩家'}…`}</strong><span>{myTurn?`需跟注 ${fmt(o?.call||0)}`:'每回合 30 秒'}</span></div><div className="raise-row"><label>加注至</label><Slider value={[Math.max(o?.min||0,Math.min(raiseTo,o?.max||0))]} onValueChange={v=>setRaiseTo(v[0])} min={o?.min||0} max={Math.max((o?.min||0)+1,o?.max||0)} step={1} disabled={!myTurn||!o?.canRaise||unavailable} aria-label="加注后本轮总额"/><output>{fmt(Math.max(o?.min||0,Math.min(raiseTo,o?.max||0)))}</output></div><div className="action-buttons"><Button variant="outline" disabled={!myTurn||unavailable} onClick={()=>sendAction('fold')}>弃牌</Button><Button variant="secondary" disabled={!myTurn||unavailable} onClick={()=>sendAction(o?.owed?'call':'check')}>{o?.owed?`跟注 ${fmt(o.call)}`:'过牌'}</Button><Button disabled={!myTurn||!o?.canRaise||unavailable} onClick={()=>sendAction('raise',Math.max(o?.min||0,Math.min(raiseTo,o?.max||0)))}>加注</Button><Button variant="outline" disabled={!myTurn||unavailable||(!o?.canRaise&&(o?.call||0)<(me?.stack||0))} onClick={()=>o?.canRaise?sendAction('raise',o.max):sendAction('call')}>全下</Button></div></>:<><div className="action-label"><strong>{room.phase===4?'再来一手？':'等待朋友准备'}</strong><span>{readyPlayers.filter(p=>p.ready).length}/{readyPlayers.length} 已准备</span></div><div className="lobby-actions">{solo?<Button disabled={busy||readyPlayers.length<2} onClick={()=>command('start')}>下一手</Button>:<><Button disabled={unavailable||!me?.stack} variant={me?.ready?'secondary':'default'} onClick={()=>command('ready')}>{me?.ready?'取消准备':'准备'}</Button>{isHost&&<Button disabled={unavailable||!allReady} onClick={()=>command('start')}>开始对局</Button>}</>}{isHost&&<AlertDialog><AlertDialogTrigger asChild><Button variant="outline">重置筹码</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>重置本桌筹码？</AlertDialogTitle><AlertDialogDescription>所有玩家回到 1,000 筹码，并重新准备。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={()=>command('reset')}>重置</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</div>{!solo&&<p className="action-help">所有在线且有筹码的玩家准备后，由房主开始。刷新页面可重新回到当前座位。</p>}</>}</div></div><aside className="game-sidebar"><div className="sidebar-card"><span className="kicker">{solo?'独自练习':'朋友的牌桌'}</span><h2>{solo?'牌桌记录':`房间 ${room.code}`}</h2><p>{solo?'电脑只根据自己的底牌和公共牌决策。':'把房间码或邀请链接发给朋友，即可一起入座。'}</p>{!solo&&<Button variant="outline" onClick={copyInvite}>{copied?'已复制':'复制邀请链接'}</Button>}</div>{room.phase===4&&room.pots.length>0&&<div className="sidebar-card"><h3>本手结算</h3>{room.pots.map((p,i)=><div className="pot-result" key={i}><span>{p.label} · {fmt(p.amount)}</span><strong>{p.names.join('、')}</strong></div>)}</div>}<div className="sidebar-card"><h3>最近行动</h3><ol className="game-log">{room.log.map((l,i)=><li key={`${room.hand}-${i}`}>{l}</li>)}</ol></div><details className="sidebar-card rules"><summary>玩法与规则</summary><p>用两张底牌和五张公共牌组成最强五张牌。牌型从高到低：同花顺、四条、葫芦、同花、顺子、三条、两对、一对、高牌。</p><p>滑杆金额是本轮加注后的总额。全下玩家只参与自己投入覆盖的底池；平局分池。超时会自动过牌，面临下注则弃牌。两人局由小盲先行动，翻牌后大盲先行动。断线超过 45 秒的玩家，下一手暂时观战；房主断线时，会在两手之间交接给在线玩家。</p></details></aside></section>}
    <footer>筹码仅用于游戏，无真实货币交易。</footer>
  </main>
}
