import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createClient,
  WhoopApiError,
  parseRetryAfter,
  buildQuery,
  joinUrl,
  MAX_PAGE_LIMIT,
  MAX_RETRY_AFTER_MS,
  DEFAULT_RETRY_AFTER_MS,
} from '../src/whoop/client.js';

const BASE = 'https://api.example.test/developer/v2';

/**
 * Build a minimal Response-like object for the stubbed fetch.
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string,string>} [headers]
 */
function res(status, body, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[String(name).toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body)),
  };
}

/** A stubbed fetch that plays back a queue of responses and records the calls. */
function stubFetch(queue) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected extra request to ${url}`);
    return typeof next === 'function' ? next(url, init) : next;
  };
  return { fetchImpl, calls };
}

test('buildQuery drops empty values and encodes the rest', () => {
  assert.equal(buildQuery({ a: 1, b: undefined, c: null, d: '', e: 'x y' }), '?a=1&e=x+y');
  assert.equal(buildQuery(), '');
  assert.equal(buildQuery({}), '');
});

test('joinUrl normalises slashes and passes absolute URLs through', () => {
  assert.equal(joinUrl('https://x.test/v2/', '/cycle'), 'https://x.test/v2/cycle');
  assert.equal(joinUrl('https://x.test/v2', 'cycle'), 'https://x.test/v2/cycle');
  assert.equal(joinUrl('https://x.test/v2', 'https://other.test/z'), 'https://other.test/z');
});

test('parseRetryAfter handles seconds, HTTP-dates and junk', () => {
  assert.equal(parseRetryAfter('2'), 2000);
  assert.equal(parseRetryAfter('0'), 0);
  assert.equal(parseRetryAfter('9999'), MAX_RETRY_AFTER_MS, 'capped at 60s');
  assert.equal(parseRetryAfter(null), DEFAULT_RETRY_AFTER_MS);
  assert.equal(parseRetryAfter('not-a-date'), DEFAULT_RETRY_AFTER_MS);
  const now = Date.parse('2026-09-13T12:00:00Z');
  assert.equal(parseRetryAfter(new Date(now + 5000).toUTCString(), now), 5000);
  assert.equal(parseRetryAfter(new Date(now - 5000).toUTCString(), now), 0, 'past dates mean retry now');
});

test('get() sends the bearer token and parses JSON', async () => {
  const { fetchImpl, calls } = stubFetch([res(200, { first_name: 'Ada' })]);
  const client = createClient({ getToken: () => 'tok-1', fetchImpl, baseUrl: BASE });
  const body = await client.get('/user/profile/basic');
  assert.deepEqual(body, { first_name: 'Ada' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE}/user/profile/basic`);
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok-1');
});

test('paginate walks three pages and follows next_token -> nextToken', async () => {
  const { fetchImpl, calls } = stubFetch([
    res(200, { records: [{ id: 1 }, { id: 2 }], next_token: 'tok-A' }),
    res(200, { records: [{ id: 3 }, { id: 4 }], next_token: 'tok-B' }),
    res(200, { records: [{ id: 5 }], next_token: null }),
  ]);
  const client = createClient({ getToken: () => 'tok', fetchImpl, baseUrl: BASE });

  const all = await client.paginate('/activity/sleep', { start: '2026-09-01T00:00:00Z' });

  assert.equal(all.length, 5);
  assert.deepEqual(all.map((r) => r.id), [1, 2, 3, 4, 5]);
  assert.equal(calls.length, 3, 'stops when next_token is null');

  const urls = calls.map((c) => new URL(c.url));
  assert.equal(urls[0].searchParams.get('limit'), String(MAX_PAGE_LIMIT));
  assert.equal(urls[0].searchParams.get('start'), '2026-09-01T00:00:00Z');
  assert.equal(urls[0].searchParams.get('nextToken'), null, 'first page carries no token');
  assert.equal(urls[1].searchParams.get('nextToken'), 'tok-A');
  assert.equal(urls[2].searchParams.get('nextToken'), 'tok-B');
});

test('paginate caps the page limit at 25 even when asked for more', async () => {
  const { fetchImpl, calls } = stubFetch([res(200, { records: [], next_token: null })]);
  const client = createClient({ getToken: () => 'tok', fetchImpl, baseUrl: BASE });
  await client.paginate('/cycle', { limit: 500 });
  assert.equal(new URL(calls[0].url).searchParams.get('limit'), '25');
});

test('pages() yields one page at a time', async () => {
  const { fetchImpl } = stubFetch([
    res(200, { records: [{ id: 1 }], next_token: 'a' }),
    res(200, { records: [{ id: 2 }], next_token: null }),
  ]);
  const client = createClient({ getToken: () => 'tok', fetchImpl, baseUrl: BASE });
  const seen = [];
  for await (const page of client.pages('/recovery')) seen.push(page);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], { records: [{ id: 1 }], next_token: 'a' });
  assert.equal(seen[1].next_token, null);
});

test('a 401 triggers exactly one refresh and one retry', async () => {
  const { fetchImpl, calls } = stubFetch([
    res(401, { message: 'expired' }),
    res(200, { records: [{ id: 7 }], next_token: null }),
  ]);
  let token = 'stale';
  let refreshes = 0;
  const client = createClient({
    getToken: () => token,
    refresh: () => {
      refreshes += 1;
      token = 'fresh';
    },
    fetchImpl,
    baseUrl: BASE,
  });

  const body = await client.get('/recovery');

  assert.equal(refreshes, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.authorization, 'Bearer stale');
  assert.equal(calls[1].init.headers.authorization, 'Bearer fresh', 'retry uses the refreshed token');
  assert.deepEqual(body.records, [{ id: 7 }]);
});

test('a second 401 is not retried again and throws WhoopApiError(401)', async () => {
  const { fetchImpl, calls } = stubFetch([res(401, { message: 'nope' }), res(401, { message: 'still nope' })]);
  let refreshes = 0;
  const client = createClient({
    getToken: () => 'tok',
    refresh: () => {
      refreshes += 1;
    },
    fetchImpl,
    baseUrl: BASE,
  });

  await assert.rejects(
    () => client.get('/recovery'),
    (err) => {
      assert.ok(err instanceof WhoopApiError);
      assert.equal(err.status, 401);
      assert.deepEqual(err.body, { message: 'still nope' });
      assert.match(err.message, /whoop-energy auth/);
      return true;
    },
  );
  assert.equal(refreshes, 1, 'refresh happens at most once per request');
  assert.equal(calls.length, 2);
});

test('a 401 without a refresh function fails immediately', async () => {
  const { fetchImpl, calls } = stubFetch([res(401, 'unauthorized')]);
  const client = createClient({ getToken: () => 'tok', fetchImpl, baseUrl: BASE });
  await assert.rejects(() => client.get('/cycle'), WhoopApiError);
  assert.equal(calls.length, 1);
});

test('429 honours Retry-After and retries with an injected sleep', async () => {
  const { fetchImpl, calls } = stubFetch([
    res(429, { message: 'slow down' }, { 'Retry-After': '2' }),
    res(429, { message: 'slow down' }, { 'Retry-After': '3' }),
    res(200, { records: [{ id: 99 }], next_token: null }),
  ]);
  /** @type {number[]} */
  const slept = [];
  const client = createClient({
    getToken: () => 'tok',
    fetchImpl,
    baseUrl: BASE,
    sleepImpl: async (ms) => {
      slept.push(ms);
    },
  });

  const body = await client.get('/activity/sleep');

  assert.deepEqual(slept, [2000, 3000], 'waits exactly what Retry-After asked for');
  assert.equal(calls.length, 3);
  assert.deepEqual(body.records, [{ id: 99 }]);
});

test('429 waits are capped at 60s and use a default when the header is absent', async () => {
  const { fetchImpl } = stubFetch([
    res(429, null, { 'Retry-After': '600' }),
    res(429, null),
    res(200, { records: [], next_token: null }),
  ]);
  const slept = [];
  const client = createClient({
    getToken: () => 'tok',
    fetchImpl,
    baseUrl: BASE,
    sleepImpl: async (ms) => slept.push(ms),
  });
  await client.get('/cycle');
  assert.deepEqual(slept, [MAX_RETRY_AFTER_MS, DEFAULT_RETRY_AFTER_MS]);
});

test('429 gives up after three retries and throws', async () => {
  const { fetchImpl, calls } = stubFetch([
    res(429, { message: 'x' }, { 'Retry-After': '1' }),
    res(429, { message: 'x' }, { 'Retry-After': '1' }),
    res(429, { message: 'x' }, { 'Retry-After': '1' }),
    res(429, { message: 'final' }, { 'Retry-After': '1' }),
  ]);
  const slept = [];
  const client = createClient({
    getToken: () => 'tok',
    fetchImpl,
    baseUrl: BASE,
    sleepImpl: async (ms) => slept.push(ms),
  });

  await assert.rejects(
    () => client.get('/cycle'),
    (err) => {
      assert.equal(err.status, 429);
      assert.deepEqual(err.body, { message: 'final' });
      return true;
    },
  );
  assert.equal(slept.length, 3, 'max 3 retries');
  assert.equal(calls.length, 4);
});

test('non-2xx errors carry status, body, url and method', async () => {
  const { fetchImpl } = stubFetch([res(500, 'boom')]);
  const client = createClient({ getToken: () => 'tok', fetchImpl, baseUrl: BASE });
  await assert.rejects(
    () => client.get('/cycle', { start: 'x' }),
    (err) => {
      assert.ok(err instanceof WhoopApiError);
      assert.equal(err.name, 'WhoopApiError');
      assert.equal(err.status, 500);
      assert.equal(err.body, 'boom');
      assert.equal(err.method, 'GET');
      assert.equal(err.url, `${BASE}/cycle?start=x`);
      return true;
    },
  );
});

test('network failures surface as WhoopApiError with status 0', async () => {
  const client = createClient({
    getToken: () => 'tok',
    baseUrl: BASE,
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  await assert.rejects(
    () => client.get('/cycle'),
    (err) => {
      assert.ok(err instanceof WhoopApiError);
      assert.equal(err.status, 0);
      assert.match(err.message, /Network error/);
      return true;
    },
  );
});

test('createClient validates its inputs', () => {
  assert.throws(() => createClient({}), TypeError);
  assert.throws(() => createClient({ getToken: () => 't', fetchImpl: null }), TypeError);
});
