#!/usr/bin/env node
/**
 * Unit tests for the pure parts of transcribe-channel.mjs.
 * Run with:  node --test scripts/
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  slugify,
  isoDurationToSeconds,
  extractVideoId,
  parseChannelRef,
  parseJson3,
  parseVtt,
  dedupeRolling,
  segmentsToText,
  formatTimestamp,
  transcriptFilename,
  renderMarkdown,
  listFromFile,
  pooled,
} from './transcribe-channel.mjs';

test('extractVideoId handles every URL shape YouTube emits', () => {
  const id = 'abcDEF12345';
  assert.equal(extractVideoId(id), id);
  assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${id}&list=PL123&t=30s`), id);
  assert.equal(extractVideoId(`https://youtu.be/${id}?si=xyz`), id);
  assert.equal(extractVideoId(`https://www.youtube.com/shorts/${id}`), id);
  assert.equal(extractVideoId(`https://www.youtube.com/embed/${id}`), id);
  assert.equal(extractVideoId(`https://www.youtube.com/live/${id}`), id);
  assert.equal(extractVideoId('https://www.youtube.com/@someone'), null);
  assert.equal(extractVideoId('not a url'), null);
});

test('parseChannelRef accepts handles, URLs and channel IDs', () => {
  const channelId = 'UCXl0djQ2IljcG-shgv-hIEA';
  assert.deepEqual(parseChannelRef('@DanielIlesbiz'), { handle: '@DanielIlesbiz' });
  assert.deepEqual(parseChannelRef('DanielIlesbiz'), { handle: '@DanielIlesbiz' });
  assert.deepEqual(
    parseChannelRef('https://youtube.com/@danielilesbiz?si=JamZHvPXuQmiP8_E'),
    { handle: '@danielilesbiz' },
  );
  assert.deepEqual(parseChannelRef('https://www.youtube.com/@danielilesbiz/videos'), { handle: '@danielilesbiz' });
  assert.deepEqual(parseChannelRef(channelId), { channelId });
  assert.deepEqual(parseChannelRef(`https://www.youtube.com/channel/${channelId}`), { channelId });
});

test('isoDurationToSeconds covers Shorts through long-form', () => {
  assert.equal(isoDurationToSeconds('PT45S'), 45);
  assert.equal(isoDurationToSeconds('PT1M30S'), 90);
  assert.equal(isoDurationToSeconds('PT1H2M3S'), 3723);
  assert.equal(isoDurationToSeconds('PT24M'), 1440);
  assert.equal(isoDurationToSeconds('P1DT2H'), 93600);
  assert.equal(isoDurationToSeconds(undefined), null);
  assert.equal(isoDurationToSeconds('garbage'), null);
});

test('slugify produces safe, bounded filenames', () => {
  assert.equal(slugify('How To Make Coaches Go Viral!'), 'how-to-make-coaches-go-viral');
  assert.equal(slugify("Don't Do This — Ever"), 'dont-do-this-ever');
  assert.equal(slugify('///'), 'untitled');
  assert.ok(slugify('a'.repeat(200)).length <= 60);
  assert.ok(!slugify('trailing punctuation ...').endsWith('-'));
});

test('parseJson3 extracts cues and drops exact repeats', () => {
  const fixture = JSON.stringify({
    events: [
      { tStartMs: 0, dDurationMs: 10 },                                      // no segs
      { tStartMs: 120, dDurationMs: 2400, segs: [{ utf8: 'the first thing' }, { utf8: ' you do' }] },
      { tStartMs: 2520, dDurationMs: 30, segs: [{ utf8: '\n' }] },           // newline-only filler
      { tStartMs: 2600, dDurationMs: 2000, segs: [{ utf8: 'the first thing you do' }] }, // exact repeat
      { tStartMs: 4700, dDurationMs: 2200, segs: [{ utf8: 'is pick one offer' }] },
    ],
  });
  const segments = parseJson3(fixture);
  assert.deepEqual(segments.map((s) => s.text), ['the first thing you do', 'is pick one offer']);
  assert.equal(segments[0].start, 0.12);
  assert.equal(segments[1].start, 4.7);
});

test('dedupeRolling returns only newly added words', () => {
  assert.equal(dedupeRolling('', 'hello there'), 'hello there');
  assert.equal(dedupeRolling('hello there', 'hello there'), '');
  assert.equal(dedupeRolling('hello there', 'hello there friend'), 'friend');
  assert.equal(dedupeRolling('a b c d', 'c d e f'), 'e f');
  assert.equal(dedupeRolling('one two three', 'three'), '');
  assert.equal(dedupeRolling('totally', 'different words'), 'different words');
  // Must not split inside a word: "cat" is not an overlap of "category".
  assert.equal(dedupeRolling('the cat', 'category theory'), 'category theory');
});

test('parseVtt unrolls scrolling auto-captions without duplicating words', () => {
  const fixture = [
    'WEBVTT',
    'Kind: captions',
    'Language: en',
    '',
    '00:00:00.080 --> 00:00:02.560 align:start position:0%',
    'the first thing you do',
    '',
    '00:00:02.560 --> 00:00:02.570 align:start position:0%',
    'the first thing you do',
    '',
    '00:00:02.570 --> 00:00:05.120 align:start position:0%',
    'the first thing you do',
    'is pick <c>one</c> offer',
    '',
    '00:01:05.000 --> 00:01:07.000',
    'and &amp; then you &#39;scale&#39; it',
    '',
  ].join('\n');

  const segments = parseVtt(fixture);
  assert.deepEqual(
    segments.map((s) => s.text),
    ['the first thing you do', 'is pick one offer', 'and & then you \'scale\' it'],
  );
  assert.equal(segments[0].start, 0.08);
  assert.equal(segments[2].start, 65);
});

test('parseVtt tolerates CRLF line endings', () => {
  const fixture = 'WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nhello world\r\n';
  assert.deepEqual(parseVtt(fixture).map((s) => s.text), ['hello world']);
});

test('segmentsToText joins cues into readable paragraphs', () => {
  const segments = [
    { start: 0, text: 'This is the first sentence.' },
    { start: 2, text: 'And here is the second one.' },
  ];
  assert.equal(segmentsToText(segments), 'This is the first sentence. And here is the second one.');
  assert.equal(segmentsToText([]), '');

  // Long transcripts get broken up rather than emitted as one wall of text.
  const long = Array.from({ length: 60 }, (_, i) => ({ start: i, text: `Sentence number ${i} goes here.` }));
  const paragraphs = segmentsToText(long).split('\n\n');
  assert.ok(paragraphs.length > 1, 'expected multiple paragraphs');
  assert.ok(paragraphs.every((p) => p.length < 800), 'paragraphs should stay bounded');
});

test('formatTimestamp switches to hours only when needed', () => {
  assert.equal(formatTimestamp(0), '0:00');
  assert.equal(formatTimestamp(65), '1:05');
  assert.equal(formatTimestamp(3661), '1:01:01');
  assert.equal(formatTimestamp(-5), '0:00');
});

test('transcriptFilename is sortable, unique and undated-safe', () => {
  assert.equal(
    transcriptFilename({ videoId: 'abcDEF12345', title: 'Go Viral Fast', publishedAt: '2024-03-09T10:00:00Z' }),
    '2024-03-09--go-viral-fast--abcDEF12345.md',
  );
  assert.equal(
    transcriptFilename({ videoId: 'abcDEF12345', title: 'Go Viral Fast', publishedAt: null }),
    'undated--go-viral-fast--abcDEF12345.md',
  );
  // Two videos sharing a title still get distinct files.
  const a = transcriptFilename({ videoId: 'aaaaaaaaaaa', title: 'Same', publishedAt: null });
  const b = transcriptFilename({ videoId: 'bbbbbbbbbbb', title: 'Same', publishedAt: null });
  assert.notEqual(a, b);
});

test('renderMarkdown escapes titles that would break YAML front matter', () => {
  const markdown = renderMarkdown(
    { videoId: 'abcDEF12345', title: 'He said: "do it" — now', publishedAt: '2024-03-09T10:00:00Z', durationSeconds: 90 },
    { language: 'en', backend: 'yt-dlp', wordCount: 3, text: 'body text here' },
    { title: 'Daniel Iles' },
  );
  const front = markdown.split('---')[1];
  assert.ok(front.includes('title: "He said: \\"do it\\" — now"'), front);
  assert.ok(front.includes('duration_seconds: 90'));
  assert.ok(markdown.includes('# He said: "do it" — now'));
  assert.ok(markdown.trimEnd().endsWith('body text here'));
});

test('listFromFile reads a plain URL list', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tc-test-'));
  try {
    const file = path.join(dir, 'urls.txt');
    await writeFile(file, [
      '# comment line',
      'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      '',
      'https://youtu.be/bbbbbbbbbbb',
      'ccccccccccc',
    ].join('\n'));
    const { videos } = await listFromFile(file, '@someone');
    assert.deepEqual(videos.map((v) => v.videoId), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listFromFile round-trips a manifest written by a previous run', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tc-test-'));
  try {
    const file = path.join(dir, 'manifest.json');
    await writeFile(file, JSON.stringify({
      channel: { title: 'Daniel Iles' },
      videos: [
        { videoId: 'aaaaaaaaaaa', title: 'One', publishedAt: '2024-01-01', durationSeconds: 30 },
        { url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', title: 'Two' },
      ],
    }));
    const { videos } = await listFromFile(file, null);
    assert.equal(videos.length, 2);
    assert.equal(videos[0].durationSeconds, 30);
    assert.equal(videos[1].videoId, 'bbbbbbbbbbb');
    assert.equal(videos[1].title, 'Two');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pooled preserves order and respects the concurrency ceiling', async () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  let active = 0;
  let peak = 0;
  const results = await pooled(items, 4, async (item) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return item * 2;
  });
  assert.deepEqual(results, items.map((i) => i * 2));
  assert.ok(peak <= 4, `peak concurrency was ${peak}`);
  assert.deepEqual(await pooled([], 4, async () => 1), []);
});
