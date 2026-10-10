import {env} from 'cloudflare:workers';
import {type Room} from './poker';
export function database(){if(!env.DB)throw new Error('牌桌服务暂时不可用，请稍后重试。');return env.DB}
export async function readRoom(code:string){const db=database().withSession('first-primary');const row=await db.prepare('SELECT state,revision,expires_at FROM poker_rooms WHERE code = ?').bind(code).first<{state:string;revision:number;expires_at:number}>();if(!row||row.expires_at<Date.now())throw new Error('房间不存在或已过期。');return{room:JSON.parse(row.state) as Room,revision:row.revision}}
export async function writeRoom(r:Room,revision:number){const result=await database().prepare('UPDATE poker_rooms SET state = ?, revision = revision + 1, expires_at = ? WHERE code = ? AND revision = ?').bind(JSON.stringify(r),Date.now()+86400000,r.code,revision).run();return result.meta.changes===1}
export async function insertRoom(r:Room){await database().prepare('INSERT INTO poker_rooms (code,state,revision,expires_at) VALUES (?,?,0,?)').bind(r.code,JSON.stringify(r),Date.now()+86400000).run()}
export async function hashToken(token:string){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('')}
