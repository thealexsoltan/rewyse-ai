# Transcribing a YouTube Channel

`scripts/transcribe-channel.mjs` pulls the transcript of every video on a
YouTube channel into clean Markdown — useful as raw source material for an
expert profile, a content blueprint, or a product built from someone's back
catalogue.

It is resumable: re-running the same command skips videos it already has and
retries only the ones that failed.

---

## Quick Start

The zero-config path needs only `yt-dlp` and works with no API keys:

```bash
pip install -U yt-dlp        # or: brew install yt-dlp

node scripts/transcribe-channel.mjs --channel @DanielIlesbiz
```

That lists the channel, fetches YouTube's own caption track for each video,
and writes everything to `output/danielilesbiz/`.

Do a trial run first to confirm the output looks right before committing to
the whole channel:

```bash
node scripts/transcribe-channel.mjs --channel @DanielIlesbiz --limit 5
```

---

## Output Layout

```
output/<channel>/
  manifest.json                              every video + per-video status
  corpus.md                                  all transcripts in one file
  video-urls.txt                             one URL per line (with --emit-list)
  failures.json                              anything that could not be fetched
  transcripts/
    2024-03-09--how-to-go-viral--abc123XYZ0.md
  timestamped/
    abc123XYZ0.json                          cue-level text with timestamps
```

Each Markdown file carries YAML front matter, so the whole folder can be fed
straight into another tool:

```markdown
---
video_id: abc123XYZ0
title: "How To Go Viral"
url: https://www.youtube.com/watch?v=abc123XYZ0
channel: "Daniel Iles"
published: 2024-03-09
duration_seconds: 1440
language: en
transcript_source: yt-dlp
word_count: 3182
---

# How To Go Viral

The first thing you do is pick one offer...
```

`manifest.json` is also a valid input file, so a partial run can be resumed or
re-targeted later with `--source file --list-file output/<channel>/manifest.json`.

---

## Backends

Listing and transcription are chosen independently, so you can mix whichever
halves your environment allows.

### Listing — where the video list comes from

| `--source` | Needs | Notes |
|-----------|-------|-------|
| `yt-dlp` | `yt-dlp` on PATH | Default. No key, no quota. Requires direct access to youtube.com. |
| `api` | `YOUTUBE_API_KEY` | YouTube Data API v3. Works in sandboxes that allow `www.googleapis.com` but block youtube.com. Also returns exact durations and view counts. |
| `file` | `--list-file` | A previous `manifest.json`, or a text file of one video ID/URL per line. |

For `--source api`, create a free key at
[console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials),
enable **YouTube Data API v3**, then:

```bash
export YOUTUBE_API_KEY=...
node scripts/transcribe-channel.mjs --channel @DanielIlesbiz --source api
```

Listing a 600-video channel costs roughly 25 units of the free 10,000/day quota.

### Transcripts — where the text comes from

| `--transcripts` | Needs | Notes |
|----------------|-------|-------|
| `yt-dlp` | `yt-dlp` on PATH | Default. Free. Uses YouTube's own caption track (auto-generated or uploaded). Nothing to transcribe if captions are disabled on a video. |
| `supadata` | `SUPADATA_API_KEY` | Paid per video. Good fallback for the handful of videos with no caption track. |
| `none` | — | Build `manifest.json` and `video-urls.txt` only. |

Auto-generated captions scroll — each cue repeats the tail of the previous one.
The script un-rolls that on whole-word boundaries, so the output reads as prose
rather than a stutter.

---

## Common Recipes

**Long-form only, skipping Shorts** (Shorts are 3 minutes or less):

```bash
node scripts/transcribe-channel.mjs --channel @DanielIlesbiz \
  --source api --min-duration 181
```

**Only the Shorts:**

```bash
node scripts/transcribe-channel.mjs --channel @DanielIlesbiz \
  --source api --max-duration 180
```

**List first, transcribe later** — useful for reviewing the set before spending
anything, or for handing the URL list to another tool:

```bash
node scripts/transcribe-channel.mjs --channel @DanielIlesbiz \
  --transcripts none --emit-list

node scripts/transcribe-channel.mjs --source file \
  --list-file output/danielilesbiz/manifest.json
```

**Fill the gaps with Supadata** after a `yt-dlp` run left some failures:

```bash
export SUPADATA_API_KEY=...
node scripts/transcribe-channel.mjs --source file \
  --list-file output/danielilesbiz/failures.json \
  --transcripts supadata --out output/danielilesbiz
```

**Go faster** (or slower, if YouTube starts throttling):

```bash
node scripts/transcribe-channel.mjs --channel @DanielIlesbiz --concurrency 8
```

---

## All Flags

```
--channel <ref>              @handle, channel URL, or UC... channel ID
--source <api|yt-dlp|file>   where the video list comes from
--list-file <path>           input for --source file
--transcripts <yt-dlp|supadata|none>
--lang <code>                caption language preference (default: en)
--min-duration <seconds>     skip anything shorter
--max-duration <seconds>     skip anything longer
--limit <n>                  stop after n videos
--out <dir>                  default: output/<channel-slug>
--emit-list                  also write video-urls.txt
--no-corpus                  skip building corpus.md
--concurrency <n>            parallel transcript fetches (default: 4)
--force                      re-fetch transcripts that already exist
--dry-run                    list and filter, fetch nothing
--help
```

---

## Troubleshooting

**`yt-dlp is not installed`** — `pip install -U yt-dlp`. If listing worked
yesterday and fails today, YouTube changed something: `yt-dlp -U`.

**`Unable to connect to proxy` / `403 Forbidden`** — your network blocks
youtube.com. Use `--source api` for listing; for transcripts you will need
`--transcripts supadata`, or run the script somewhere with direct access.

**`no caption track available`** — that video has captions disabled. Re-run
those with `--transcripts supadata`, which transcribes the audio itself.

**A run died halfway** — just run the same command again. Completed
transcripts are skipped and only the rest are fetched.

**Everything failed at once** — check `failures.json`. A single repeated
message across every video usually means a bad key, an exhausted quota, or
rate limiting; retry with `--concurrency 1`.

---

## Tests

```bash
node --test scripts/transcribe-channel.test.mjs
```

Covers URL and channel-reference parsing, both caption formats, the
scrolling-caption de-duplication, filename and front-matter generation,
manifest round-tripping, and the concurrency pool.
