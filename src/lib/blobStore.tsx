'use client';
// 이미지/파일 저장 (v2.0)
//  · 서버 모드: Supabase Storage 버킷(ohome)에 올리고, 저장하는 값은 공개 URL
//  · 로컬 모드: IndexedDB (파일 id만 데이터에 저장)
// 화면 코드는 항상 "참조 문자열"만 다루므로 두 모드가 같은 코드로 동작한다.
import React, { useEffect, useState } from 'react';
import { newId } from './postStore';
import { backend, isServerMode } from './backend';
import { getSetting } from './settingStore';

const DB_NAME = 'ohome-blobs';
const STORE = 'files';

/** 확장자 추론 — Storage에 올릴 때 파일 이름에 쓴다 */
function extOf(blob: Blob): string {
  const t = blob.type || '';
  if (t.includes('png')) return 'png';
  if (t.includes('gif')) return 'gif';
  if (t.includes('webp')) return 'webp';
  if (t.includes('svg')) return 'svg';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('font') || t.includes('woff')) return 'woff2';
  if (t.startsWith('text/')) return 'txt';
  return 'bin';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---------- 업로드 진행 상태 (v2.0) ----------
   서버가 느릴 때 아무 반응이 없어 보여서 사용자가 업로드를 다시 누르게 된다.
   지금 몇 건이 올라가는 중인지 알려 화면에 표시할 수 있게 한다. */
export const UPLOAD_EVT = 'ohome-upload';
let uploading = 0;
const bump = (n: number) => {
  uploading = Math.max(0, uploading + n);
  window.dispatchEvent(new Event(UPLOAD_EVT));
};

/** 지금 올라가는 중인 파일 수 */
export function useUploading(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const h = () => setN(uploading);
    h();
    window.addEventListener(UPLOAD_EVT, h);
    return () => window.removeEventListener(UPLOAD_EVT, h);
  }, []);
  return n;
}

/* 같은 파일을 두 번 올리지 않게 (v2.0 사용자 발견) — 업로드가 느려서 다시 누르면
   같은 이미지가 여러 장 생기던 문제. 내용이 같으면 앞선 업로드의 결과를 그대로 돌려준다.
   (올라가는 중이면 그 약속을 함께 기다린다 — 두 번 올라가지 않는다) */
const sent = new Map<string, Promise<string>>();

async function hashOf(blob: Blob): Promise<string | null> {
  try {
    const buf = await blob.arrayBuffer();
    const d = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;   // 보안 컨텍스트가 아니면 해시를 못 구한다 — 그땐 그냥 올린다
  }
}

/** Blob 저장 → 참조 문자열 반환 (서버 모드: 공개 URL · 로컬 모드: 파일 id) */
export async function putBlob(blob: Blob): Promise<string> {
  const key = await hashOf(blob);
  const hit = key ? sent.get(key) : undefined;
  if (hit) return hit;
  const job = putBlobNew(blob, key);
  if (key) {
    sent.set(key, job);
    // 실패한 업로드는 캐시에 남기지 않는다 — 다시 시도할 수 있어야 한다
    job.catch(() => sent.delete(key));
  }
  return job;
}

async function putBlobNew(blob: Blob, hash: string | null): Promise<string> {
  bump(1);
  try {
    return await putBlobRaw(blob, hash);
  } finally {
    bump(-1);
  }
}

/* ---------- 목록용 썸네일 (v2.1) ----------
   목록 화면이 원본(수 MB)을 그대로 받아 작은 칸에 줄여 보여 주던 것이 다운로드 용량의 대부분이었다.
   올릴 때 작은 사본을 thumb/<해시>로 함께 올리고, 원본 이름 끝에 -t를 붙여 「썸네일 있음」을 표시한다.
   → 데이터 구조를 바꾸지 않고 원본 주소만 보고 썸네일 주소를 알 수 있다 (thumbUrlOf).
   -t가 없는 파일(예전 업로드·작은 그림·GIF)은 목록에서도 원본을 쓴다. */
const THUMB_TYPES = /^image\/(png|jpeg|webp|avif|bmp)$/;   // GIF·SVG는 움직임·벡터가 사라지므로 제외
const THUMB_MIN_BYTES = 150 * 1024;   // 이보다 작으면 줄여 봐야 이득이 없다
const THUMB_SHORT = 640;              // 짧은 변 — 목록 칸(≈300px)을 고해상도 화면(2배)에서도 선명하게
const THUMB_LONG = 1600;              // 아주 긴 그림의 긴 변 상한

/** 썸네일 대상이 될 만한 크기 — 이보다 작은 파일은 내려받아 볼 필요도 없다 (기존 이미지 썸네일 만들기) */
export const THUMB_MIN_SIZE = THUMB_MIN_BYTES;

export async function makeThumb(blob: Blob): Promise<Blob | null> {
  if (!THUMB_TYPES.test(blob.type) || blob.size < THUMB_MIN_BYTES) return null;
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });   // 휴대폰 사진 회전(EXIF) 반영
    const { width: w, height: h } = bmp;
    const s = Math.min(1, THUMB_SHORT / Math.min(w, h), THUMB_LONG / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * s));
    const th = Math.max(1, Math.round(h * s));
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    const g = c.getContext('2d');
    if (!g) { bmp.close(); return null; }
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, tw, th);
    bmp.close();
    const enc = (type: string, q?: number) => new Promise<Blob | null>(ok => c.toBlob(ok, type, q));
    let out = await enc('image/webp', 0.8);
    if (!out || out.type !== 'image/webp') {
      // WebP를 못 만드는 브라우저(옛 Safari)는 PNG를 돌려준다 — 투명한 곳이 없으면 JPEG로
      const px = g.getImageData(0, 0, tw, th).data;
      let alpha = false;
      for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { alpha = true; break; }
      out = await enc(alpha ? 'image/png' : 'image/jpeg', 0.82);
    }
    // 원본과 별 차이 없으면 사본을 두는 것이 오히려 손해
    return out && out.size < blob.size * 0.7 ? out : null;
  } catch {
    return null;   // 못 읽는 이미지 — 썸네일 없이 원본만
  }
}

const HASH = '[0-9a-f]{64}';
const FB_THUMBED = new RegExp(`^(https://firebasestorage\\.googleapis\\.com/v0/b/[^/]+/o/)ohome%2F(${HASH})-t\\.[a-z0-9]+\\?`);
const SB_THUMBED = new RegExp(`^(https?://[^?#]+/storage/v1/object/public/ohome/)(${HASH})-t\\.[a-z0-9]+(?:[?#]|$)`);

/* 썸네일 기능 이전에 올린 파일 (v2.1) — 이름에 -t 표시가 없어 주소만으로는 썸네일 유무를 모른다.
   환경설정의 「기존 이미지 썸네일 만들기」가 thumb/<원래 파일명>으로 사본을 만들고, 만든 파일명을
   이 설정에 적는다. 설정은 화면을 그리기 전에 받아 두므로(primeSettings) 렌더 중에 동기로 읽힌다.
   글 데이터·원본 파일은 건드리지 않는다 — 주소를 바꿔 쓰는 것보다 훨씬 안전하다 */
export const THUMB_LIST_KEY = 'ohome.thumbs.v1';
/** t: 썸네일을 만든 원본 파일명 · n: 살펴봤지만 썸네일이 필요 없던 파일명(다음에 다시 받지 않게) */
export interface ThumbList { t: string[]; n: string[] }
let listMemo: { src: unknown; set: Set<string> } | null = null;
function thumbedOld(): Set<string> {
  const v = getSetting<ThumbList | null>(THUMB_LIST_KEY, null);
  if (!listMemo || listMemo.src !== v) listMemo = { src: v, set: new Set(Array.isArray(v?.t) ? v.t : []) };
  return listMemo.set;
}
const OLD_NAME = '[a-z0-9]+\\.[a-z0-9]+';   // 루트의 예전 이름(무작위·해시) — thumb/ 아래·-t 붙은 파일은 해당 없음
const FB_OLD = new RegExp(`^(https://firebasestorage\\.googleapis\\.com/v0/b/[^/]+/o/)ohome%2F(${OLD_NAME})\\?`);
const SB_OLD = new RegExp(`^(https?://[^?#]+/storage/v1/object/public/ohome/)(${OLD_NAME})(?:[?#]|$)`);

/** 원본 주소 → 썸네일 주소 (썸네일을 만들어 둔 파일만, 아니면 undefined).
 *  Firebase 주소의 token은 원본 것이라 떼고 공개 읽기(alt=media)로 받는다 — 저장소 규칙이 읽기를 공개로 둔다 */
export function thumbUrlOf(ref?: string): string | undefined {
  if (!ref) return undefined;
  let m = FB_THUMBED.exec(ref);
  if (m) return `${m[1]}ohome%2Fthumb%2F${m[2]}?alt=media`;
  m = SB_THUMBED.exec(ref);
  if (m) return `${m[1]}thumb/${m[2]}`;
  m = FB_OLD.exec(ref);
  if (m && thumbedOld().has(m[2])) return `${m[1]}ohome%2Fthumb%2F${m[2]}?alt=media`;
  m = SB_OLD.exec(ref);
  if (m && thumbedOld().has(m[2])) return `${m[1]}thumb/${m[2]}`;
  return undefined;
}

/** 저장소 주소 → 버킷 안 경로 (token 등 주소 꼬리가 달라도 같은 파일이면 같은 값) — 이미지 정리의 대조용 */
export function fileKey(ref: string): string {
  const fb = /firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?#]+)/.exec(ref);
  if (fb) return decodeURIComponent(fb[1]);
  const sb = /\/storage\/v1\/object\/public\/([^?#]+)/.exec(ref);
  if (sb) return decodeURIComponent(sb[1]);
  return ref;
}

async function putBlobRaw(blob: Blob, hash: string | null): Promise<string> {
  const be = isServerMode() ? backend() : null;
  if (be) {   // 서버 모드 — 공개 URL 반환
    const ext = extOf(blob);
    if (!hash) return be.uploadFile(blob, ext);
    /* 내용 해시를 파일 이름으로 (v2.1) — 같은 그림은 언제 어디서 올려도 한 번만 저장된다.
       (위 sent 캐시는 탭을 닫으면 사라져서, 다른 날 같은 그림을 올리면 파일이 또 생겼다)
       썸네일을 먼저 올린다 — 원본 이름의 -t가 「썸네일이 있다」는 약속이므로 */
    let mark = '';
    const thumb = await makeThumb(blob);
    if (thumb) {
      try { await be.uploadFile(thumb, '', `thumb/${hash}`); mark = '-t'; } catch { /* 썸네일만 실패 — 목록에서도 원본을 쓴다 */ }
    }
    return be.uploadFile(blob, ext, `${hash}${mark}.${ext}`);
  }
  const id = newId();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return id;
}

/** promoteToStorage의 결과 — 안 됐으면 **왜** 안 됐는지까지 알려 준다.
 *  조용히 실패하면 사용자는 「올렸는데 왜 안 보이지」에서 막힌다 (v2.0 사용자 지적). */
export type PromoteResult =
  | { kind: 'already' }                 // 이미 저장소 주소 — 할 일 없음
  | { kind: 'local-mode' }              // 서버 연결이 없다 — 올릴 곳 자체가 없음
  | { kind: 'no-origin' }               // 이 브라우저에 원본이 없다 (다른 브라우저에서 올린 것)
  | { kind: 'uploaded'; url: string }
  | { kind: 'failed'; error: string };

/**
 * 브라우저에만 있는 파일을 서버 저장소로 올려 준다 (v2.0 사용자 발견).
 *
 * 백엔드를 붙이기 전에 저장한 이미지는 참조가 IndexedDB 파일 id라, 올린 그 브라우저에서만
 * 보이고 다른 데서 로그인하면 안 보인다. 원본이 이 브라우저에 아직 있으면 저장소로 올린다.
 *
 * putBlob이 내용 해시로 걸러 주므로 여러 번 불려도 같은 파일이 두 번 올라가지 않는다.
 */
export async function promoteToStorage(ref?: string): Promise<PromoteResult> {
  if (!ref || /^(https?:|data:)/.test(ref)) return { kind: 'already' };
  if (!isServerMode()) return { kind: 'local-mode' };
  // blob: 은 새로고침하면 죽는 참조 — 원본을 되찾을 방법이 없다
  if (ref.startsWith('blob:')) return { kind: 'no-origin' };
  let blob: Blob | null = null;
  try {
    blob = await getBlob(ref);
  } catch (e) {
    return { kind: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
  if (!blob) return { kind: 'no-origin' };
  try {
    const url = await putBlob(blob);
    return url === ref ? { kind: 'already' } : { kind: 'uploaded', url };
  } catch (e) {
    return { kind: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

/** 전체 파일 목록 (id → Blob) — 데이터 백업 내보내기용 (5.2) */
export async function allBlobs(): Promise<Map<string, Blob>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out = new Map<string, Blob>();
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) { resolve(out); return; }
      out.set(String(cur.key), cur.value as Blob);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** 지정 id로 Blob 저장 — 백업 복원용 (기존 id 유지) */
export async function putBlobAs(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getBlob(id: string): Promise<Blob | null> {
  // 서버 모드에서 저장된 값은 공개 URL — 그대로 받아 온다 (백업 zip 내보내기 등에서 사용)
  if (/^https?:/.test(id)) {
    try {
      const res = await fetch(id);
      return res.ok ? await res.blob() : null;
    } catch { return null; }
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as Blob) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/* 세션 내 objectURL 캐시 (id → url) */
const urlCache = new Map<string, string>();

/**
 * 파일 참조 → 표시 가능한 URL.
 * - http(s)/data: 는 그대로
 * - blob: 은 새로고침 후 죽은 참조 → undefined (플레이스홀더 폴백)
 * - 그 외는 IndexedDB 파일 id로 간주해 로드
 */
export function useBlobUrl(ref?: string): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => {
    if (!ref) return undefined;
    if (/^(https?:|data:)/.test(ref)) return ref;
    if (ref.startsWith('blob:')) return undefined;
    return urlCache.get(ref);
  });

  useEffect(() => {
    if (!ref) { setUrl(undefined); return; }
    if (/^(https?:|data:)/.test(ref)) { setUrl(ref); return; }
    if (ref.startsWith('blob:')) { setUrl(undefined); return; }
    if (urlCache.has(ref)) { setUrl(urlCache.get(ref)); return; }
    let alive = true;
    getBlob(ref).then(b => {
      if (b && alive) {
        const u = URL.createObjectURL(b);
        urlCache.set(ref, u);
        setUrl(u);
      }
    }).catch(() => { /* 없으면 플레이스홀더 */ });
    return () => { alive = false; };
  }, [ref]);

  return url;
}

/* 받아지지 않은 썸네일 — 같은 화면에서 다시 시도하지 않고 바로 원본으로 (규칙이 공개 읽기를 막는 경우 등) */
const deadThumbs = new Set<string>();

/**
 * 목록용 표시 주소 — 썸네일이 있으면 썸네일, 없거나 실패하면 원본 (v2.1).
 * 돌려주는 onError를 <img>에 걸어 두면 썸네일이 안 받아질 때 원본으로 바뀐다.
 * on=false면 항상 원본 (크게 확대된 크롭 등 썸네일로는 흐려지는 자리).
 */
export function useThumbSrc(ref?: string, on = true): [string | undefined, (() => void) | undefined] {
  const full = useBlobUrl(ref);
  const [, bump] = useState(0);
  const t = on ? thumbUrlOf(ref) : undefined;
  if (!t || deadThumbs.has(t)) return [full, undefined];
  return [t, () => { deadThumbs.add(t); bump(n => n + 1); }];
}

/** 파일 참조 이미지 — 없으면 플레이스홀더(ph) 폴백. thumb: 목록 칸처럼 작게 보이는 자리면 썸네일로 */
export function BlobImg({ fileRef, ph, alt, style, imgStyle, label, thumb }: {
  fileRef?: string; ph?: string; alt?: string;
  style?: React.CSSProperties; imgStyle?: React.CSSProperties; label?: string; thumb?: boolean;
}) {
  const [url, onError] = useThumbSrc(fileRef, !!thumb);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={alt ?? ''} loading="lazy" decoding="async" onError={onError}
      style={{ width: '100%', height: '100%', objectFit: 'cover', ...imgStyle }} />;
  }
  return <div className={`ph ${ph ?? ''}`} style={{ width: '100%', height: '100%', ...style }}>{label && <span>{label}</span>}</div>;
}
