#!/usr/bin/env node
/**
 * transcribe-channel.mjs — bulk-transcribe every video on a YouTube channel.
 *
 * Two independent halves, each with swappable backends:
 *
 *   1. LISTING    where the video list comes from
 *        --source api      YouTube Data API v3   (needs YOUTUBE_API_KEY, works behind
 *                                                 proxies that allow www.googleapis.com)
 *        --source yt-dlp   yt-dlp                (no key, needs youtube.com reachable)
 *        --source file     a manifest/URL list you already have
 *
 *   2. TRANSCRIPTS  where the text comes from
 *        --transcripts yt-dlp     YouTube's own caption tracks (free, no key)
 *        --transcripts supadata   Supadata API   (needs SUPADATA_API_KEY)
 *        --transcripts none       build the manifest only
 *
 * Everything is resumable: re-running skips videos already transcribed.
 *
 * Usage:
 *   node scripts/transcribe-channel.mjs --channel @DanielIlesbiz
 *   node scripts/transcribe-channel.mjs --channel @DanielIlesbiz --source api --transcripts supadata
 *   node scripts/transcribe-channel.mjs --channel @DanielIlesbiz --transcripts none --emit-list
 *
 * Run with --help for all flags.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------- CLI parsing

const HELP = `
transcribe-channel.mjs — bulk-transcribe a YouTube channel

Required:
  --channel <ref>          @handle, channel URL, or UC... channel ID
                           (not needed with --source file)

Listing:
  --source <api|yt-dlp|file>   default: api if YOUTUBE_API_KEY is set, else yt-dlp
  --list-file <path>           with --source file: JSON manifest, or a text file
                               of one video ID/URL per line

Transcripts:
  --transcripts <yt-dlp|supadata|none>   default: yt-dlp
  --lang <code>                caption language preference (default: en)

Filtering:
  --min-duration <seconds>     skip anything shorter (e.g. 61 to drop Shorts)
  --max-duration <seconds>     skip anything longer
  --limit <n>                  stop after n videos (useful for a trial run)

Output:
  --out <dir>              default: output/<channel-slug>
  --emit-list              also write video-urls.txt (one URL per line)
  --no-corpus              skip building the combined corpus.md

Behaviour:
  --concurrency <n>        parallel transcript fetches (default: 4)
  --force                  re-fetch transcripts that already exist
  --dry-run                list and filter, but fetch no transcripts
  --help
`.trimStart();

function parseArgs(argv) {
  const opts = {
    channel: null,
    source: null,
    listFile: null,
    transcripts: 'yt-dlp',
    lang: 'en',
    minDuration: null,
    maxDuration: null,
    limit: null,
    out: null,
    emitList: false,
    corpus: true,
    concurrency: 4,
    force: false,
    dryRun: false,
  };
  const takesValue = new Set([
    '--channel', '--source', '--list-file', '--transcripts', '--lang',
    '--min-duration', '--max-duration', '--limit', '--out', '--concurrency',
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { console.log(HELP); process.exit(0); }
    if (takesValue.has(arg)) {
      const value = argv[++i];
      if (value === undefined) fail(`${arg} needs a value`);
      switch (arg) {
        case '--channel': opts.channel = value; break;
        case '--source': opts.source = value; break;
        case '--list-file': opts.listFile = value; break;
        case '--transcripts': opts.transcripts = value; break;
        case '--lang': opts.lang = value; break;
        case '--min-duration': opts.minDuration = intArg(arg, value); break;
        case '--max-duration': opts.maxDuration = intArg(arg, value); break;
        case '--limit': opts.limit = intArg(arg, value); break;
        case '--out': opts.out = value; break;
        case '--concurrency': opts.concurrency = intArg(arg, value); break;
      }
      continue;
    }
    switch (arg) {
      case '--emit-list': opts.emitList = true; break;
      case '--no-corpus': opts.corpus = false; break;
      case '--force': opts.force = true; break;
      case '--dry-run': opts.dryRun = true; break;
      default: fail(`unknown flag: ${arg}\n\n${HELP}`);
    }
  }

  if (!opts.source) opts.source = process.env.YOUTUBE_API_KEY ? 'api' : 'yt-dlp';
  if (!['api', 'yt-dlp', 'file'].includes(opts.source)) fail(`--source must be api, yt-dlp or file`);
  if (!['yt-dlp', 'supadata', 'none'].includes(opts.transcripts)) {
    fail(`--transcripts must be yt-dlp, supadata or none`);
  }
  if (opts.source === 'file' && !opts.listFile) fail(`--source file needs --list-file`);
  if (opts.source !== 'file' && !opts.channel) fail(`--channel is required\n\n${HELP}`);
  if (opts.concurrency < 1) fail(`--concurrency must be at least 1`);
  return opts;
}

function intArg(flag, value) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) fail(`${flag} needs an integer, got "${value}"`);
  return n;
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

// ------------------------------------------------------------------- helpers

const log = (...args) => console.log(...args);

export function slugify(text, maxLength = 60) {
  const slug = String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['"’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (slug.slice(0, maxLength).replace(/-+$/, '')) || 'untitled';
}

/** Parse an ISO-8601 duration (PT1H2M3S) into seconds. */
export function isoDurationToSeconds(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, min, s] = m;
  return (Number(d || 0) * 86400) + (Number(h || 0) * 3600) + (Number(min || 0) * 60) + Math.round(Number(s || 0));
}

/** Pull an 11-character video ID out of a URL, or accept a bare ID. */
export function extractVideoId(input) {
  const text = String(input).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /\/shorts\/([A-Za-z0-9_-]{11})/,
    /\/embed\/([A-Za-z0-9_-]{11})/,
    /\/live\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  return null;
}

/** Normalise @handle / URL / UC-id into { handle } or { channelId }. */
export function parseChannelRef(ref) {
  const text = String(ref).trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  const idMatch = /(?:^|channel\/)(UC[A-Za-z0-9_-]{22})$/.exec(text);
  if (idMatch) return { channelId: idMatch[1] };
  const handleMatch = /@([A-Za-z0-9._-]+)/.exec(text);
  if (handleMatch) return { handle: `@${handleMatch[1]}` };
  if (/^[A-Za-z0-9._-]+$/.test(text)) return { handle: `@${text}` };
  fail(`could not read a channel handle or ID out of "${ref}"`);
}

function channelUrl(ref) {
  const parsed = parseChannelRef(ref);
  return parsed.channelId
    ? `https://www.youtube.com/channel/${parsed.channelId}`
    : `https://www.youtube.com/${parsed.handle}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run a task over items with a bounded number of workers, preserving input order. */
export async function pooled(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Retry with exponential backoff. `attempts` includes the first try. */
async function withRetry(label, attempts, fn) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (error?.fatal || attempt === attempts) break;
      const delay = 1000 * 2 ** (attempt - 1);
      log(`  retry ${attempt}/${attempts - 1} for ${label} in ${delay}ms — ${error.message}`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function run(command, args, { timeout = 300000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// --------------------------------------------------------- listing: Data API

const API_BASE = 'https://www.googleapis.com/youtube/v3';

async function apiGet(endpoint, params, apiKey) {
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  url.searchParams.set('key', apiKey);

  return withRetry(`GET ${endpoint}`, 4, async () => {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body?.error?.message || `HTTP ${response.status}`;
      const error = new Error(`YouTube API: ${message}`);
      // Bad key / quota exhausted / not found will never succeed on retry.
      if (response.status === 400 || response.status === 403 || response.status === 404) error.fatal = true;
      throw error;
    }
    return body;
  });
}

async function listViaApi(channelRef, apiKey) {
  const parsed = parseChannelRef(channelRef);
  const lookup = parsed.channelId ? { id: parsed.channelId } : { forHandle: parsed.handle };
  const channelResponse = await apiGet('channels', {
    part: 'snippet,contentDetails,statistics',
    ...lookup,
  }, apiKey);

  const channel = channelResponse.items?.[0];
  if (!channel) fail(`YouTube API found no channel for "${channelRef}"`);

  const uploadsPlaylist = channel.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylist) fail(`channel ${channel.id} exposes no uploads playlist`);

  const info = {
    channelId: channel.id,
    title: channel.snippet?.title ?? channel.id,
    handle: channel.snippet?.customUrl ?? parsed.handle ?? null,
    videoCount: Number(channel.statistics?.videoCount ?? 0) || null,
  };
  log(`channel: ${info.title} (${info.channelId})${info.videoCount ? ` — ${info.videoCount} videos reported` : ''}`);

  // Page through the uploads playlist.
  const videos = [];
  let pageToken;
  do {
    const page = await apiGet('playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylist,
      maxResults: 50,
      pageToken,
    }, apiKey);
    for (const item of page.items ?? []) {
      const videoId = item.contentDetails?.videoId;
      if (!videoId) continue;
      videos.push({
        videoId,
        title: item.snippet?.title ?? videoId,
        publishedAt: item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt ?? null,
        description: item.snippet?.description ?? '',
        durationSeconds: null,
      });
    }
    pageToken = page.nextPageToken;
    log(`  listed ${videos.length} videos…`);
  } while (pageToken);

  // Durations come from videos.list, 50 IDs at a time — needed to separate Shorts.
  for (let i = 0; i < videos.length; i += 50) {
    const batch = videos.slice(i, i + 50);
    const details = await apiGet('videos', {
      part: 'contentDetails,statistics',
      id: batch.map((v) => v.videoId).join(','),
    }, apiKey);
    const byId = new Map((details.items ?? []).map((item) => [item.id, item]));
    for (const video of batch) {
      const item = byId.get(video.videoId);
      video.durationSeconds = isoDurationToSeconds(item?.contentDetails?.duration);
      video.viewCount = Number(item?.statistics?.viewCount ?? 0) || null;
    }
  }

  return { info, videos };
}

// ----------------------------------------------------------- listing: yt-dlp

async function ensureYtDlp() {
  const probe = await run('yt-dlp', ['--version'], { timeout: 30000 });
  if (probe.code !== 0) {
    fail('yt-dlp is not installed or not on PATH.\n' +
      '  install it with:  pip install -U yt-dlp   (or: brew install yt-dlp)');
  }
  return probe.stdout.trim();
}

async function listViaYtDlp(channelRef) {
  const version = await ensureYtDlp();
  log(`listing with yt-dlp ${version} (this can take a minute on a large channel)…`);

  // A channel's uploads are split across tabs: /videos holds long-form, /shorts
  // holds Shorts, /streams holds past live streams. Listing only /videos misses
  // most of a Shorts-heavy channel, so walk all three and merge.
  const base = channelUrl(channelRef);
  const tabs = ['videos', 'shorts', 'streams'];
  const byId = new Map();
  let info = null;

  for (const tab of tabs) {
    const url = `${base}/${tab}`;
    const result = await run('yt-dlp', [
      '--flat-playlist',
      '--dump-single-json',
      '--ignore-errors',
      '--no-warnings',
      url,
    ], { timeout: 900000 });

    if (!result.stdout.trim()) {
      // An empty tab exits non-zero — that is normal, not a failure.
      log(`  ${tab}: none`);
      continue;
    }

    let payload;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      log(`  ${tab}: skipped (yt-dlp returned output that is not JSON)`);
      continue;
    }

    // A channel tab can nest entries one level deep (tab -> playlist -> videos).
    const flatten = (entries) => (entries ?? []).flatMap((entry) => (
      Array.isArray(entry?.entries) ? flatten(entry.entries) : [entry]
    ));

    let added = 0;
    for (const entry of flatten(payload.entries)) {
      if (!entry) continue;
      const videoId = extractVideoId(entry.id ?? entry.url ?? '');
      if (!videoId || byId.has(videoId)) continue;
      byId.set(videoId, {
        videoId,
        title: entry.title ?? videoId,
        publishedAt: entry.upload_date
          ? `${entry.upload_date.slice(0, 4)}-${entry.upload_date.slice(4, 6)}-${entry.upload_date.slice(6, 8)}`
          : null,
        description: entry.description ?? '',
        durationSeconds: entry.duration != null ? Math.round(entry.duration) : null,
        viewCount: entry.view_count ?? null,
        tab,
      });
      added++;
    }
    log(`  ${tab}: ${added}`);

    if (!info && (payload.channel || payload.channel_id)) {
      info = {
        channelId: payload.channel_id ?? payload.uploader_id ?? null,
        title: payload.channel ?? String(channelRef),
        handle: payload.uploader_id ?? null,
      };
    }
  }

  const videos = [...byId.values()];
  if (!videos.length) {
    fail(`yt-dlp found no videos on ${base} — check the channel reference, or run yt-dlp -U`);
  }

  return {
    info: { ...(info ?? { channelId: null, title: String(channelRef), handle: null }), videoCount: videos.length },
    videos,
  };
}


// ------------------------------------------------------------- listing: file

export async function listFromFile(listFile, channelRef) {
  const raw = await readFile(listFile, 'utf8');
  let videos = [];

  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    const entries = Array.isArray(parsed) ? parsed : (parsed.videos ?? []);
    videos = entries.map((entry) => {
      if (typeof entry === 'string') {
        const videoId = extractVideoId(entry);
        return videoId ? { videoId, title: videoId, publishedAt: null, durationSeconds: null } : null;
      }
      const videoId = extractVideoId(entry.videoId ?? entry.id ?? entry.url ?? '');
      if (!videoId) return null;
      return {
        videoId,
        title: entry.title ?? videoId,
        publishedAt: entry.publishedAt ?? null,
        description: entry.description ?? '',
        durationSeconds: entry.durationSeconds ?? null,
        viewCount: entry.viewCount ?? null,
        tab: entry.tab ?? null,
      };
    }).filter(Boolean);
  } else {
    videos = trimmed.split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const videoId = extractVideoId(line);
        return videoId ? { videoId, title: videoId, publishedAt: null, durationSeconds: null } : null;
      })
      .filter(Boolean);
  }

  if (!videos.length) fail(`no video IDs found in ${listFile}`);
  const info = {
    channelId: null,
    title: channelRef ? String(channelRef) : path.basename(listFile, path.extname(listFile)),
    handle: null,
    videoCount: videos.length,
  };
  return { info, videos };
}

// ------------------------------------------------- transcripts: caption parsing

/**
 * YouTube's json3 caption format. Auto-captions repeat words across cues to
 * animate them, so we drop segments the previous cue already emitted.
 */
export function parseJson3(raw) {
  const data = JSON.parse(raw);
  const segments = [];
  for (const event of data.events ?? []) {
    if (!event.segs) continue;
    const text = event.segs.map((seg) => seg.utf8 ?? '').join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || text === '\n') continue;
    const start = (event.tStartMs ?? 0) / 1000;
    const previous = segments[segments.length - 1];
    if (previous && previous.text === text) continue;
    segments.push({ start, duration: (event.dDurationMs ?? 0) / 1000, text });
  }
  return segments;
}

export function timestampToSeconds(stamp) {
  const parts = stamp.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts;
  return (h * 3600) + (m * 60) + s;
}

/**
 * Auto-caption VTT scrolls: each cue repeats the tail of the previous cue and
 * adds a few new words. Return only the words `text` adds on top of
 * `previousText`, matching on whole words so nothing is cut mid-word.
 */
export function dedupeRolling(previousText, text) {
  if (!previousText) return text;
  if (text === previousText) return '';
  if (previousText.endsWith(text)) return '';
  const previousWords = previousText.split(' ');
  const words = text.split(' ');
  const maxOverlap = Math.min(previousWords.length, words.length);
  for (let k = maxOverlap; k > 0; k--) {
    if (previousWords.slice(-k).join(' ') === words.slice(0, k).join(' ')) {
      return words.slice(k).join(' ');
    }
  }
  return text;
}

/**
 * WebVTT fallback, used when a video has no json3 caption track.
 */
export function parseVtt(raw) {
  const segments = [];
  const blocks = raw.replace(/\r/g, '').split('\n\n');
  for (const block of blocks) {
    const lines = block.split('\n');
    const cueIndex = lines.findIndex((line) => line.includes('-->'));
    if (cueIndex === -1) continue;
    const [startStamp] = lines[cueIndex].split('-->').map((part) => part.trim().split(' ')[0]);
    const text = lines.slice(cueIndex + 1)
      .join(' ')
      .replace(/<[^>]*>/g, '')       // inline karaoke timing tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const previous = segments[segments.length - 1];
    const added = previous ? dedupeRolling(previous.text, text) : text;
    if (!added) continue;
    segments.push({ start: timestampToSeconds(startStamp), duration: 0, text: added });
  }
  return segments;
}

export function segmentsToText(segments) {
  // Join into sentence-ish paragraphs so the output reads as prose.
  const words = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
  if (!words) return '';
  const sentences = words.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [words];
  const paragraphs = [];
  let buffer = [];
  for (const sentence of sentences) {
    buffer.push(sentence.trim());
    if (buffer.join(' ').length > 500) {
      paragraphs.push(buffer.join(' '));
      buffer = [];
    }
  }
  if (buffer.length) paragraphs.push(buffer.join(' '));
  return paragraphs.join('\n\n');
}

export function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// --------------------------------------------------- transcripts: yt-dlp backend

async function fetchTranscriptYtDlp(video, { lang, tempRoot }) {
  const workdir = path.join(tempRoot, video.videoId);
  await mkdir(workdir, { recursive: true });
  try {
    const result = await run('yt-dlp', [
      '--skip-download',
      '--write-auto-subs',
      '--write-subs',
      '--sub-langs', `${lang}.*,${lang}`,
      '--sub-format', 'json3/vtt/best',
      '--no-warnings',
      '--ignore-errors',
      '-o', path.join(workdir, '%(id)s'),
      `https://www.youtube.com/watch?v=${video.videoId}`,
    ], { timeout: 180000 });

    const files = existsSync(workdir) ? await readdir(workdir) : [];
    const subtitle = files.find((f) => f.endsWith('.json3')) ?? files.find((f) => f.endsWith('.vtt'));
    if (!subtitle) {
      const reason = /private|unavailable|removed|members-only|age/i.test(result.stderr)
        ? result.stderr.trim().split('\n').slice(-1)[0]
        : 'no caption track available';
      const error = new Error(reason);
      error.fatal = true;   // missing captions won't appear on a retry
      throw error;
    }

    const raw = await readFile(path.join(workdir, subtitle), 'utf8');
    const segments = subtitle.endsWith('.json3') ? parseJson3(raw) : parseVtt(raw);
    if (!segments.length) {
      const error = new Error('caption track was empty');
      error.fatal = true;
      throw error;
    }
    const langMatch = /\.([A-Za-z-]+)\.(json3|vtt)$/.exec(subtitle);
    return { segments, language: langMatch?.[1] ?? lang, backend: 'yt-dlp' };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

// ------------------------------------------------- transcripts: Supadata backend

const SUPADATA_BASE = 'https://api.supadata.ai/v1';

async function supadataRequest(url, apiKey) {
  const response = await fetch(url, { headers: { 'x-api-key': apiKey, accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Supadata: ${body?.message || body?.error || `HTTP ${response.status}`}`);
    // 4xx other than rate-limit means this video will never succeed.
    if (response.status >= 400 && response.status < 500 && response.status !== 429) error.fatal = true;
    throw error;
  }
  return body;
}

async function fetchTranscriptSupadata(video, { lang, apiKey }) {
  const url = new URL(`${SUPADATA_BASE}/transcript`);
  url.searchParams.set('url', `https://www.youtube.com/watch?v=${video.videoId}`);
  url.searchParams.set('lang', lang);

  let body = await supadataRequest(url, apiKey);

  // Long videos come back as an async job.
  if (body.jobId) {
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
      await sleep(5000);
      const job = await supadataRequest(`${SUPADATA_BASE}/transcript/${body.jobId}`, apiKey);
      if (job.status === 'completed') { body = job; break; }
      if (job.status === 'failed') {
        const error = new Error(`Supadata job failed: ${job.error ?? 'unknown reason'}`);
        error.fatal = true;
        throw error;
      }
    }
    if (body.jobId) throw new Error('Supadata job did not finish within 10 minutes');
  }

  const content = body.content ?? body.transcript ?? body.result?.content;
  let segments;
  if (Array.isArray(content)) {
    segments = content
      .map((chunk) => ({
        start: (chunk.offset ?? chunk.start ?? 0) / 1000,
        duration: (chunk.duration ?? 0) / 1000,
        text: String(chunk.text ?? '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((chunk) => chunk.text);
  } else if (typeof content === 'string' && content.trim()) {
    segments = [{ start: 0, duration: 0, text: content.replace(/\s+/g, ' ').trim() }];
  } else {
    const error = new Error('Supadata returned no transcript content');
    error.fatal = true;
    throw error;
  }

  return { segments, language: body.lang ?? lang, backend: 'supadata' };
}

// -------------------------------------------------------------------- output

export function transcriptFilename(video) {
  const date = (video.publishedAt ?? '').slice(0, 10) || 'undated';
  return `${date}--${slugify(video.title)}--${video.videoId}.md`;
}

export function renderMarkdown(video, transcript, channelInfo) {
  const yamlString = (value) => JSON.stringify(String(value ?? ''));
  const front = [
    '---',
    `video_id: ${video.videoId}`,
    `title: ${yamlString(video.title)}`,
    `url: https://www.youtube.com/watch?v=${video.videoId}`,
    `channel: ${yamlString(channelInfo.title)}`,
    video.publishedAt ? `published: ${video.publishedAt.slice(0, 10)}` : null,
    video.durationSeconds != null ? `duration_seconds: ${video.durationSeconds}` : null,
    video.viewCount != null ? `view_count: ${video.viewCount}` : null,
    `language: ${transcript.language}`,
    video.tab ? `tab: ${video.tab}` : null,
    `transcript_source: ${transcript.backend}`,
    `word_count: ${transcript.wordCount}`,
    '---',
    '',
  ].filter((line) => line !== null);

  return [
    ...front,
    `# ${video.title}`,
    '',
    transcript.text,
    '',
  ].join('\n');
}

async function writeTranscript(outDir, video, transcript, channelInfo) {
  const markdown = renderMarkdown(video, transcript, channelInfo);
  await writeFile(path.join(outDir, 'transcripts', transcriptFilename(video)), markdown, 'utf8');
  await writeFile(
    path.join(outDir, 'timestamped', `${video.videoId}.json`),
    JSON.stringify({
      videoId: video.videoId,
      title: video.title,
      url: `https://www.youtube.com/watch?v=${video.videoId}`,
      language: transcript.language,
      source: transcript.backend,
      segments: transcript.segments.map((s) => ({
        start: Number(s.start.toFixed(2)),
        timestamp: formatTimestamp(s.start),
        text: s.text,
      })),
    }, null, 2),
    'utf8',
  );
}

async function buildCorpus(outDir, channelInfo, manifest) {
  const done = manifest.videos.filter((v) => v.status === 'ok');
  const parts = [
    `# ${channelInfo.title} — transcript corpus`,
    '',
    `${done.length} transcripts · ${done.reduce((sum, v) => sum + (v.wordCount ?? 0), 0).toLocaleString('en-US')} words`,
    `Generated ${new Date().toISOString().slice(0, 10)}`,
    '',
  ];
  for (const video of done) {
    const file = path.join(outDir, 'transcripts', video.file);
    if (!existsSync(file)) continue;
    const raw = await readFile(file, 'utf8');
    parts.push('---', '', raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim(), '');
  }
  await writeFile(path.join(outDir, 'corpus.md'), parts.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // 1. List the channel.
  let listing;
  if (opts.source === 'api') {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      fail('--source api needs YOUTUBE_API_KEY.\n' +
        '  create a free key at https://console.cloud.google.com/apis/credentials\n' +
        '  (enable "YouTube Data API v3"), then:  export YOUTUBE_API_KEY=...');
    }
    listing = await listViaApi(opts.channel, apiKey);
  } else if (opts.source === 'yt-dlp') {
    listing = await listViaYtDlp(opts.channel);
  } else {
    listing = await listFromFile(opts.listFile, opts.channel);
  }

  const { info: channelInfo } = listing;
  let videos = listing.videos;
  log(`found ${videos.length} videos`);

  // 2. Filter.
  const before = videos.length;
  if (opts.minDuration != null) {
    videos = videos.filter((v) => v.durationSeconds == null || v.durationSeconds >= opts.minDuration);
  }
  if (opts.maxDuration != null) {
    videos = videos.filter((v) => v.durationSeconds == null || v.durationSeconds <= opts.maxDuration);
  }
  if (before !== videos.length) log(`  ${videos.length} after duration filter (dropped ${before - videos.length})`);
  if (opts.limit != null) {
    videos = videos.slice(0, opts.limit);
    log(`  limited to ${videos.length}`);
  }

  // 3. Prepare output.
  const outDir = path.resolve(opts.out ?? path.join('output', slugify(channelInfo.handle ?? channelInfo.title)));
  await mkdir(path.join(outDir, 'transcripts'), { recursive: true });
  await mkdir(path.join(outDir, 'timestamped'), { recursive: true });
  log(`output: ${outDir}`);

  if (opts.emitList) {
    await writeFile(
      path.join(outDir, 'video-urls.txt'),
      videos.map((v) => `https://www.youtube.com/watch?v=${v.videoId}`).join('\n') + '\n',
      'utf8',
    );
    log(`wrote video-urls.txt (${videos.length} URLs)`);
  }

  const manifest = {
    channel: channelInfo,
    generatedAt: new Date().toISOString(),
    listingSource: opts.source,
    transcriptSource: opts.transcripts,
    videos: videos.map((v) => ({ ...v, status: 'pending', file: transcriptFilename(v) })),
  };
  const manifestPath = path.join(outDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  if (opts.transcripts === 'none' || opts.dryRun) {
    log(`\nmanifest written to ${manifestPath}`);
    log(opts.dryRun ? 'dry run — no transcripts fetched.' : 'listing only — no transcripts fetched.');
    return;
  }

  // 4. Fetch transcripts.
  let backend;
  if (opts.transcripts === 'yt-dlp') {
    await ensureYtDlp();
    const tempRoot = path.join(os.tmpdir(), `yt-transcripts-${process.pid}`);
    await mkdir(tempRoot, { recursive: true });
    backend = (video) => fetchTranscriptYtDlp(video, { lang: opts.lang, tempRoot });
  } else {
    const apiKey = process.env.SUPADATA_API_KEY;
    if (!apiKey) {
      fail('--transcripts supadata needs SUPADATA_API_KEY (https://supadata.ai — export SUPADATA_API_KEY=...)');
    }
    backend = (video) => fetchTranscriptSupadata(video, { lang: opts.lang, apiKey });
  }

  const total = manifest.videos.length;
  let completed = 0;

  await pooled(manifest.videos, opts.concurrency, async (entry) => {
    const target = path.join(outDir, 'transcripts', entry.file);
    if (!opts.force && existsSync(target)) {
      entry.status = 'ok';
      entry.skipped = true;
      completed++;
      log(`[${completed}/${total}] skip (already have) ${entry.videoId}`);
      return;
    }

    try {
      const result = await withRetry(entry.videoId, 3, () => backend(entry));
      const text = segmentsToText(result.segments);
      const transcript = {
        ...result,
        text,
        wordCount: text.split(/\s+/).filter(Boolean).length,
      };
      await writeTranscript(outDir, entry, transcript, channelInfo);
      entry.status = 'ok';
      entry.wordCount = transcript.wordCount;
      entry.language = transcript.language;
      completed++;
      log(`[${completed}/${total}] ok   ${entry.videoId}  ${transcript.wordCount} words  ${entry.title.slice(0, 60)}`);
    } catch (error) {
      entry.status = 'failed';
      entry.error = error.message;
      completed++;
      log(`[${completed}/${total}] FAIL ${entry.videoId}  ${error.message}`);
    }
    // Checkpoint after every video so an interrupted run loses nothing.
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  });

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const ok = manifest.videos.filter((v) => v.status === 'ok');
  const failed = manifest.videos.filter((v) => v.status === 'failed');

  if (opts.corpus && ok.length) {
    await buildCorpus(outDir, channelInfo, manifest);
    log(`\nbuilt corpus.md`);
  }
  if (failed.length) {
    await writeFile(
      path.join(outDir, 'failures.json'),
      JSON.stringify(failed.map((v) => ({ videoId: v.videoId, title: v.title, error: v.error })), null, 2),
      'utf8',
    );
  }

  const words = ok.reduce((sum, v) => sum + (v.wordCount ?? 0), 0);
  log(`\ndone: ${ok.length}/${total} transcribed (${words.toLocaleString('en-US')} words), ${failed.length} failed`);
  log(`output: ${outDir}`);
  if (failed.length) log(`re-run the same command to retry the failures (successes are skipped).`);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
