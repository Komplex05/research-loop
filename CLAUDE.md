# Research Loop — Claude Code Context

## Project Purpose
Automated research agent that picks up question files, queries the Claude API, and writes results to `research-results/`.

## Structure
- `questions/` — drop `.md` files here with a topic; processed files move to `questions/processed/`
- `research-results/` — output files land here, named after the source question file
- `logs/` — cron run logs
- `engine.mjs` — Claude API logic (reads a question, returns a research summary)
- `run.mjs` — daily runner (scans questions/, calls engine, writes results)

## How to Run
```bash
node run.mjs
```

## Environment
- `ANTHROPIC_API_KEY` — required in `.env`

## Notes
- Question files must start with `# Topic` on the first line
- Results are written as Markdown
