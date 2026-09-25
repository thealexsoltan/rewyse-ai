# Daniel Iles — channel index

Complete video index for [@danielilesbiz](https://www.youtube.com/@danielilesbiz)
(channel ID `UCTt7n8GFS6x_Tc_nAzSiK8Q`), captured with
`scripts/transcribe-channel.mjs`.

**235 videos — 81 long-form (30.2 hours) + 154 Shorts.** No live streams.
Last checked against the live channel on 2026-09-25 (up 16 from the original 219).

| File | What it is |
|------|-----------|
| `videos.json` | Full index: video ID, title, URL, source tab, duration |
| `videos.tsv` | Same data as a spreadsheet-friendly table |
| `video-urls.txt` | One watch URL per line, for piping into other tools |
| `transcripts/` | One Markdown file per video — see transcript status below |

## Transcript status

A full run on 2026-09-25 transcribed **222 of 235** videos (433,398 words):
all 81 long-form videos and 141 of 154 Shorts. The 13 misses are Shorts with
no caption track at all — wordless clips over music — so 222 is full coverage
of everything that has captions, not a partial run.

The count matters: a channel's uploads are split across tabs, and the `/videos`
tab alone holds only 72 of these. The other 147 live under `/shorts`.

## Filling in the transcripts

The index is complete; the transcripts are not. Fetching captions needs a
network YouTube will actually serve — it rate-limits and bot-gates datacenter
IPs, which is what blocked the automated attempt.

From a normal home or office connection:

```bash
pip install -U yt-dlp
node scripts/transcribe-channel.mjs \
  --source file --list-file transcripts/daniel-iles/videos.json \
  --channel "@danielilesbiz" \
  --out transcripts/daniel-iles
```

That writes `transcripts/*.md` (YAML front matter plus the text),
`timestamped/*.json` (cue-level, with timestamps), a combined `corpus.md`, and
`failures.json`. It is resumable — re-run the same command and it skips what it
already has.

If yt-dlp gets gated on your network too, the script says so explicitly rather
than reporting every video as caption-less. Fall back to a paid backend:

```bash
export SUPADATA_API_KEY=...
node scripts/transcribe-channel.mjs \
  --source file --list-file transcripts/daniel-iles/videos.json \
  --channel "@danielilesbiz" --transcripts supadata \
  --out transcripts/daniel-iles
```

Only long-form, skipping Shorts:

```bash
node scripts/transcribe-channel.mjs --source file \
  --list-file transcripts/daniel-iles/videos.json \
  --channel "@danielilesbiz" --min-duration 181 \
  --out transcripts/daniel-iles
```

See [TRANSCRIBE-CHANNEL.md](../../TRANSCRIBE-CHANNEL.md) for all options.
