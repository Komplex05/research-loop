# Research Loop

A living, scheduled research system powered by Claude. It researches topics daily, critiques its own findings, detects meaningful changes over time, and goes quiet when nothing new is found.

## What this project does

1. Reads topic files from `questions/`
2. Interviews the user once to build a personal profile (skin type, budget, preferences, etc.)
3. Runs a research → adversarial critique → refined answer loop
4. On subsequent runs, compares new findings against previous results
5. Flags changes with `⚠️ CHANGED`, marks stable topics so they stop running
6. Auto-commits everything to git after each run

## Repo structure

```
questions/           ← topic files you create (one per research topic)
  processed/         ← (unused currently, reserved for future archiving)
research-results/    ← output markdown files, one per topic, appended over time
logs/                ← cron output logs
engine.mjs           ← all Claude API logic, file parsing, research loop
run.mjs              ← daily runner, orchestrates all topics end-to-end
package.json
CLAUDE.md            ← this file
README.md            ← user-facing docs
```

## Key files

### engine.mjs
All the core logic. Exports:
- `callClaude(systemPrompt, userMessage, opts)` — calls Claude API, shows progress dots
- `parseQuestionFile(filepath)` → `{ topic, context, profile, pendingQuestions, stable, refresh }`
- `writeQuestionFile(filepath, data)` — writes updated question file back to disk
- `runClarification(questionData)` → `profile` — interviews user in terminal, returns answered profile
- `runResearchLoop(topic, profile, rounds)` → `passes[]` — runs research + critique + refine
- `detectChange(topic, previousFinal, newFinal)` → `{ changed, summary, significance }` — Claude judges if findings meaningfully changed
- `buildResultEntry(passes, profile, isFirstRun, changeInfo)` → markdown string for appending to result file
- `getResultPath(outputDir, topic)` → filepath slug
- `extractLastFinalAnswer(resultContent)` → the final answer text from the most recent run

### run.mjs
The daily runner. For each `.md` file in `questions/`:
1. Skips if `# Stable` tag present
2. Resets and re-interviews if `# Refresh: true` tag present
3. Runs clarification interview if no profile exists
4. Runs research loop
5. Compares against previous result (change detection)
6. Answers any `# Questions` in the topic file, appends to result
7. Marks topic `# Stable` if no change found
8. Commits changed files to git with descriptive message

## Question file format

```markdown
# Topic
best soap for acne prone skin

# Context              ← optional, pre-answers some clarification questions
- drugstore only
- no fragrance

# Profile              ← written by the system after first clarification interview
- What is your skin type?: oily
- Any concerns alongside acne?: some redness

# Questions            ← optional, answered and appended to result on next run
- Does this change seasonally?

# Stable               ← written by system when no change detected, skip future runs
# Refresh: true        ← add manually to reset Stable and re-interview
```

## Result file format

One file per topic in `research-results/`, named as a slug of the topic.
Each daily run appends a `## Run:` section. The file grows over time as a research journal.

```markdown
# Research: best soap for acne prone skin

---

## Run: 4/12/2026, 8:00:00 AM

> ⚠️ CHANGED — New evidence suggests CeraVe outperforms Neutrogena for oily skin

**Profile:**
- skin type: oily

### Research (Round 1)
**Confidence: 74% (MEDIUM)**
...

### Critique (Round 1)
**Revised Confidence: 61% (MEDIUM)**
...

### Final Answer
**Final Confidence: 78% (MEDIUM)**
...

### Q&A

**Q: Does this change seasonally?**
...
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | required | Anthropic API key |
| `RESEARCH_ROUNDS` | `1` | Number of research+critique cycles before final synthesis |
| `AUTO_GIT` | `true` | Set `false` to disable auto-commit |

## Running

```bash
node run.mjs           # process all topics in questions/
```

## Cron schedule (daily 8am)

```bash
0 8 * * * cd /path/to/research-loop && ANTHROPIC_API_KEY=sk-ant-... node run.mjs >> logs/daily.log 2>&1
```

## Common tasks for Claude Code

**Add a new research topic:**
Create a new `.md` file in `questions/` with at minimum a `# Topic` section.

**Reset a stable topic:**
Add `# Refresh: true` to the question file. It will re-interview and re-research on next run.

**Add a follow-up question to an existing topic:**
Add a `# Questions` section to the question file with bullet points. They get answered on next run and appended to the result file.

**Tune how Claude researches:**
Edit the `PROMPTS` object in `engine.mjs`. The prompts are: `clarify`, `research`, `critique`, `refine`, `compare`.

**Change detection sensitivity:**
The `compare` prompt in `engine.mjs` defines what counts as a meaningful change. Edit it to make detection stricter or looser.

**Check what changed in results:**
```bash
git log --oneline research-results/
git diff HEAD~1 research-results/best-soap-for-acne-prone-skin.md
```

## What NOT to do

- Do not manually edit the `# Profile` or `# Stable` sections in question files — the system manages these
- Do not delete result files unless you want the topic treated as a first run again
- Do not change the `# Topic` value in a question file after first run — it's used as the result file key
