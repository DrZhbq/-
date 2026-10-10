import type {RoomView} from './poker';

export type Session = {code: string; token: string};
export class PokerRequestError extends Error {
  constructor(message: string, public status = 0, public sessionLost = false) {
    super(message);
  }
  get temporary() { return this.status === 0 || this.status >= 500; }
}

// Storage may be unavailable in private/restricted browser contexts.
export function readStorage(key: string, session = false) {
  try { return (session ? sessionStorage : localStorage).getItem(key); } catch { return null; }
}
export function writeStorage(key: string, value: string | null, session = false) {
  try {
    const storage = session ? sessionStorage : localStorage;
    if (value === null) storage.removeItem(key); else storage.setItem(key, value);
  } catch { /* The current in-memory session remains usable. */ }
}
export function readSession(): Session | null {
  try {
    const saved = JSON.parse(readStorage('last-hand-session', true) || 'null');
    if (/^[A-Z2-9]{6}$/.test(saved?.code) && /^[a-f0-9]{64}$/.test(saved?.token)) return saved;
  } catch { /* Ignore corrupt browser data. */ }
  return null;
}

export async function sendRequest(auth: Session, op: string, extra: Record<string, unknown>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('/api/poker', {
      method: 'POST', signal: controller.signal,
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}`},
      body: JSON.stringify({op, code: auth.code, requestId: crypto.randomUUID(), ...extra}),
    });
    let result: {room?: RoomView; error?: string};
    try { result = await response.json() as typeof result; }
    catch { throw new PokerRequestError('牌桌连接暂时不可用，正在重试。', 503); }
    if (!response.ok) {
      const message = typeof result.error === 'string' ? result.error : '牌桌连接暂时不可用。';
      throw new PokerRequestError(message, response.status, /^(会话失效|房间不存在或已过期)/.test(message));
    }
    if (!result.room?.code || !Array.isArray(result.room.players)) throw new PokerRequestError('牌桌响应异常，正在重试。', 503);
    return result.room;
  } catch (error) {
    if (error instanceof PokerRequestError) throw error;
    throw new PokerRequestError(controller.signal.aborted ? '连接超时，正在重试。' : '连接中断，正在重试。');
  } finally { clearTimeout(timer); }
}
