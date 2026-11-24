import { getChapterById, getSectorById } from './levels';
import { PALETTE, type GameMode, type GameState, type RunTraceStep } from './types';

const TRACE_GLYPHS: Record<RunTraceStep, string> = {
  capture: '🔵',
  skip: '⚡',
  boost: '⚡',
  deflect: '🛡️',
  goal: '🏁',
  crash: '💥',
};

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export function buildShareUrl(mode: GameMode, sectorId: number, beatScore: number): string {
  try {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.delete('unlock');
    if (mode === 'adventure') {
      url.searchParams.set('mode', 'adventure');
      url.searchParams.set('sector', String(sectorId));
    } else {
      url.searchParams.delete('mode');
      url.searchParams.delete('sector');
    }
    if (beatScore > 0) {
      url.searchParams.set('beat', String(Math.floor(beatScore)));
    } else {
      url.searchParams.delete('beat');
    }
    return url.toString();
  } catch {
    return '';
  }
}

export function formatRunTraceEmoji(trace: readonly RunTraceStep[]): string {
  if (trace.length === 0) return '🔵';
  const maxVisible = 14;
  const truncated = trace.length > maxVisible;
  const slice = truncated ? trace.slice(trace.length - maxVisible) : trace;
  const glyphs = slice.map((step) => TRACE_GLYPHS[step]).join('');
  return truncated ? `…${glyphs}` : glyphs;
}

export function buildShareText(state: GameState): string {
  const traceStrip = formatRunTraceEmoji(state.runTrace);
  const beatHook = state.score > 0 ? `Can you beat ${state.score}?` : 'Try Orbit Sling:';

  if (state.mode === 'adventure') {
    const sector = getSectorById(state.adventureSectorId);
    const chapter = getChapterById(sector.chapterId);
    const shareUrl = buildShareUrl('adventure', sector.id, state.score);

    if (state.status === 'victory' && state.adventureSummary) {
      const summary = state.adventureSummary;
      const earned = Math.max(0, Math.min(3, summary.starsEarned));
      const starsStr = `${'★'.repeat(earned)}${'☆'.repeat(3 - earned)}`;
      const lines = [
        `ORBIT SLING · CH ${chapter.code} · SECTOR ${summary.sectorCode} ${summary.sectorName}`,
        `${starsStr} · Score ${state.score} · Max x${Math.max(1, summary.maxCombo)}`,
        traceStrip,
        beatHook,
      ];
      if (shareUrl) lines.push(shareUrl);
      return lines.join('\n');
    }

    const current = Math.max(0, state.adventureCurrentAnchorIndex);
    const total = Math.max(1, state.adventureTotalAnchors);
    const lines = [
      `ORBIT SLING · CH ${chapter.code} · SECTOR ${sector.code} ${sector.name}`,
      `Reached ${current}/${total} · Score ${state.score} · Max x${Math.max(1, state.maxCombo)}`,
      traceStrip,
      beatHook,
    ];
    if (shareUrl) lines.push(shareUrl);
    return lines.join('\n');
  }

  const orbitsLabel = state.anchorsCaptured === 1 ? '1 orbit' : `${state.anchorsCaptured} orbits`;
  const shareUrl = buildShareUrl('endless', 1, state.score);
  const lines = [
    'ORBIT SLING · ENDLESS',
    `Score ${state.score} · Max x${Math.max(1, state.maxCombo)} · ${orbitsLabel}`,
    traceStrip,
    beatHook,
  ];
  if (shareUrl) lines.push(shareUrl);
  return lines.join('\n');
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy textarea copy
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawStarPolygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  filled: boolean
): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = -Math.PI * 0.5 + (i * Math.PI) / 5;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = PALETTE.gold;
    ctx.fill();
  }
  ctx.strokeStyle = filled ? PALETTE.goldSoft : 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

/**
 * Generates a crisp 1080x1080 minimalist Orbital Telemetry PNG score card
 * directly on an offscreen HTML5 Canvas (zero external libraries or assets).
 */
export async function renderScoreCardBlob(state: GameState): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const size = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const isVictory = state.status === 'victory';
  const isAdventure = state.mode === 'adventure';
  const accent = isVictory ? PALETTE.gold : PALETTE.cyan;
  const monoFont = "ui-monospace, 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace";

  // 1. Deep slate-obsidian radial backdrop
  const bgGrad = ctx.createRadialGradient(size * 0.5, size * 0.38, 60, size * 0.5, size * 0.5, size * 0.78);
  bgGrad.addColorStop(0, '#121C30');
  bgGrad.addColorStop(0.58, PALETTE.bg);
  bgGrad.addColorStop(1, PALETTE.bgDeep);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  // 2. Subtle telemetry grid
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.05)';
  ctx.lineWidth = 1;
  const step = 90;
  for (let p = step; p < size; p += step) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  // 3. Deterministic subtle starfield
  let seed = 1337 + state.score * 31 + state.adventureSectorId * 97;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 72; i++) {
    const sx = rand() * size;
    const sy = rand() * size;
    const sr = 1 + rand() * 1.8;
    ctx.fillStyle = i % 5 === 0 ? 'rgba(125, 211, 252, 0.45)' : 'rgba(203, 213, 225, 0.35)';
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Decorative orbital rings behind hero metric
  ctx.save();
  ctx.translate(size * 0.5, 425);
  ctx.strokeStyle = isVictory ? 'rgba(245, 184, 65, 0.14)' : 'rgba(56, 189, 248, 0.14)';
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 10]);
  ctx.beginPath();
  ctx.arc(0, 0, 265, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  ctx.beginPath();
  ctx.arc(0, 0, 345, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 5. Outer precision frame
  drawRoundedRect(ctx, 44, 44, size - 88, size - 88, 28);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 6. Header branding + mode badge
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.cyan;
  ctx.font = `700 22px ${monoFont}`;
  ctx.fillText('ORBITAL TELEMETRY // RUN CARD', size * 0.5, 114);

  ctx.fillStyle = PALETTE.white;
  ctx.font = `700 58px ${monoFont}`;
  ctx.fillText('ORBIT SLING', size * 0.5, 176);

  let modeBadgeText = 'ENDLESS MODE';
  if (isAdventure) {
    const sector = getSectorById(state.adventureSectorId);
    const chapter = getChapterById(sector.chapterId);
    modeBadgeText = `CH ${chapter.code} · SECTOR ${sector.code} · ${sector.name}`;
  }

  ctx.font = `700 23px ${monoFont}`;
  const badgeW = Math.min(size - 160, Math.max(320, ctx.measureText(modeBadgeText).width + 58));
  drawRoundedRect(ctx, (size - badgeW) * 0.5, 224, badgeW, 48, 24);
  ctx.fillStyle = isVictory ? 'rgba(245, 184, 65, 0.14)' : 'rgba(56, 189, 248, 0.12)';
  ctx.fill();
  ctx.strokeStyle = isVictory ? 'rgba(245, 184, 65, 0.45)' : 'rgba(56, 189, 248, 0.38)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = isVictory ? PALETTE.goldSoft : PALETTE.cyanSoft;
  ctx.fillText(modeBadgeText, size * 0.5, 248);

  // 7. Hero Score + optional Victory Stars
  if (isVictory && state.adventureSummary) {
    const earned = state.adventureSummary.starsEarned;
    for (let i = 0; i < 3; i++) {
      const sx = size * 0.5 + (i - 1) * 76;
      drawStarPolygon(ctx, sx, 336, 26, 11.5, i < earned);
    }
  }

  ctx.fillStyle = PALETTE.slate;
  ctx.font = `600 22px ${monoFont}`;
  ctx.fillText(isVictory ? 'EXTRACTION SCORE' : 'FINAL SCORE', size * 0.5, isVictory ? 404 : 362);

  ctx.fillStyle = PALETTE.white;
  ctx.font = `700 148px ${monoFont}`;
  ctx.fillText(String(state.score), size * 0.5, isVictory ? 498 : 464);

  // 8. Visual Flight Trace (custom canvas node graph)
  const trace = state.runTrace.length > 0 ? state.runTrace : (['capture'] as const);
  const maxNodes = 14;
  const visibleTrace = trace.length > maxNodes ? trace.slice(trace.length - maxNodes) : trace;
  const traceY = 612;
  const spanW = Math.min(760, Math.max(120, (visibleTrace.length - 1) * 56));
  const startX = (size - spanW) * 0.5;

  if (visibleTrace.length > 1) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.moveTo(startX, traceY);
    ctx.lineTo(startX + spanW, traceY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (let i = 0; i < visibleTrace.length; i++) {
    const stepKind = visibleTrace[i];
    const nx =
      visibleTrace.length === 1 ? size * 0.5 : startX + (spanW * i) / (visibleTrace.length - 1);
    const color =
      stepKind === 'goal' || stepKind === 'skip' || stepKind === 'boost'
        ? PALETTE.gold
        : stepKind === 'crash' || stepKind === 'deflect'
          ? PALETTE.coral
          : PALETTE.cyan;
    const radius = stepKind === 'goal' || stepKind === 'crash' ? 14 : 10;

    ctx.fillStyle = PALETTE.bg;
    ctx.beginPath();
    ctx.arc(nx, traceY, radius + 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(nx, traceY, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 9. Three Stat Cards
  const stats = [
    { label: 'MAX COMBO', value: `x${Math.max(1, state.maxCombo)}`, color: PALETTE.cyan },
    {
      label: isAdventure ? 'PROGRESS' : 'ORBITS',
      value: isAdventure
        ? `${state.adventureCurrentAnchorIndex}/${Math.max(1, state.adventureTotalAnchors)}`
        : String(state.anchorsCaptured),
      color: PALETTE.white,
    },
    {
      label: 'SHARDS',
      value: isAdventure
        ? `${state.shardsCollected}/${state.adventureTotalShards}`
        : String(state.shardsCollected),
      color: PALETTE.gold,
    },
  ];

  const cardW = 266;
  const cardH = 126;
  const cardGap = 24;
  const cardsStartX = (size - (cardW * 3 + cardGap * 2)) * 0.5;
  const cardsY = 682;

  for (let i = 0; i < stats.length; i++) {
    const cx = cardsStartX + i * (cardW + cardGap);
    drawRoundedRect(ctx, cx, cardsY, cardW, cardH, 16);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = PALETTE.slate;
    ctx.font = `600 19px ${monoFont}`;
    ctx.fillText(stats[i].label, cx + cardW * 0.5, cardsY + 40);

    ctx.fillStyle = stats[i].color;
    ctx.font = `700 40px ${monoFont}`;
    ctx.fillText(stats[i].value, cx + cardW * 0.5, cardsY + 86);
  }

  // 10. Footer challenge CTA + URL
  ctx.fillStyle = accent;
  ctx.font = `700 28px ${monoFont}`;
  ctx.fillText(
    state.score > 0 ? `CAN YOU BEAT ${state.score}?` : 'DRAG ANYWHERE TO SLING',
    size * 0.5,
    884
  );

  let hostLabel = 'ORBIT SLING';
  try {
    hostLabel = window.location.host || 'ORBIT SLING';
  } catch {
    hostLabel = 'ORBIT SLING';
  }
  ctx.fillStyle = PALETTE.slateLight;
  ctx.font = `600 22px ${monoFont}`;
  ctx.fillText(hostLabel, size * 0.5, 932);

  ctx.fillStyle = PALETTE.slateMuted;
  ctx.font = `500 18px ${monoFont}`;
  ctx.fillText('Built by Angelo Palpalatoc', size * 0.5, 978);

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

export async function shareRunResult(state: GameState): Promise<ShareOutcome> {
  const text = buildShareText(state);
  const isTouchDevice =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  if (isTouchDevice && typeof navigator.share === 'function') {
    // Try Web Share Level 2 with generated PNG score card first when supported
    if (typeof navigator.canShare === 'function') {
      try {
        const blob = await renderScoreCardBlob(state);
        if (blob) {
          const file = new File([blob], `orbit-sling-${state.score}.png`, { type: 'image/png' });
          const fileShareData: ShareData = {
            title: 'Orbit Sling',
            text,
            files: [file],
          };
          if (navigator.canShare(fileShareData)) {
            await navigator.share(fileShareData);
            return 'shared';
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          return 'cancelled';
        }
        // Fall through to text-only Web Share or clipboard
      }
    }

    try {
      await navigator.share({ title: 'Orbit Sling', text });
      return 'shared';
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  const copied = await copyTextToClipboard(text);
  return copied ? 'copied' : 'failed';
}

export function buildFacebookShareUrl(state: GameState): string {
  const shareUrl = buildShareUrl(state.mode, state.adventureSectorId, state.score);
  const quote = buildShareText(state).replace(/\nhttps?:\/\/\S+$/, '');
  const params = new URLSearchParams({
    u: shareUrl || window.location.origin,
    quote,
  });
  return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
}

export function buildXShareUrl(state: GameState): string {
  const text = buildShareText(state);
  const params = new URLSearchParams({ text });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

/**
 * Instagram has no clickable web share intent; copy the challenge URL for IG's
 * Story Link Sticker while sharing/downloading the 1080x1080 PNG score card.
 */
export async function shareForInstagram(
  state: GameState,
  cachedBlob?: Blob | null
): Promise<'shared' | 'saved' | 'cancelled' | 'failed'> {
  const shareUrl = buildShareUrl(state.mode, state.adventureSectorId, state.score);
  if (shareUrl) {
    void copyTextToClipboard(shareUrl);
  }

  const blob = cachedBlob ?? (await renderScoreCardBlob(state));
  if (!blob) return 'failed';

  const isTouchDevice =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  if (isTouchDevice && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
    try {
      const file = new File([blob], `orbit-sling-${state.score}.png`, { type: 'image/png' });
      const data: ShareData = {
        title: 'Orbit Sling',
        text: buildShareText(state),
        files: [file],
      };
      if (navigator.canShare(data)) {
        await navigator.share(data);
        return 'shared';
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  const saved = triggerBlobDownload(blob, state);
  return saved ? 'saved' : 'failed';
}

function triggerBlobDownload(blob: Blob, state: GameState): boolean {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const suffix =
    state.mode === 'adventure'
      ? `sector-${String(state.adventureSectorId).padStart(2, '0')}-${state.score}`
      : `endless-${state.score}`;
  link.download = `orbit-sling-${suffix}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function downloadScoreCard(
  state: GameState,
  cachedBlob?: Blob | null
): Promise<boolean> {
  const blob = cachedBlob ?? (await renderScoreCardBlob(state));
  if (!blob) return false;
  return triggerBlobDownload(blob, state);
}
