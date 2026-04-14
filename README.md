# Research Loop

A living research system powered by Claude. Drop a topic file, answer a few questions once, and it researches daily — flagging changes, going stable when nothing new is found, and never bothering you again until something shifts.

---

## How it works

1. You drop a `.md` file in `questions/` with a topic
2. First run: Claude interviews you for your profile (skin type, budget, etc.)
3. Claude researches → critiques its own findings → produces a refined answer
4. Results saved to `research-results/` and committed to git
5. Every subsequent daily run re-researches and compares against the last result
6. If nothing changed: topic marked **STABLE**, skipped forever until you refresh it
7. If something changed: result flagged **⚠️ CHANGED**, new findings appended

---

## Setup

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-yourkey
git init && git remote add origin https://github.com/you/research-loop.git
node run.mjs
```

---

## Question file format

Minimal:
```markdown
# Topic
best soap for acne prone skin
```

With pre-answered context:
```markdown
# Topic
best soap for acne prone skin

# Context
- drugstore only
- no fragrance
```

With follow-up questions:
```markdown
# Topic
best soap for acne prone skin

# Questions
- Does this change seasonally?
- What about body wash for the same skin type?
```

To force a full re-interview and reset STABLE:
```markdown
# Topic
best soap for acne prone skin

# Refresh: true
```

---

## Scheduling (daily at 8am)

```bash
crontab -e
# Add:
0 8 * * * cd /path/to/research-loop && ANTHROPIC_API_KEY=sk-ant-... node run.mjs >> logs/daily.log 2>&1
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | required | Your Anthropic API key |
| `RESEARCH_ROUNDS` | `1` | Critique rounds per run (1-3) |
| `AUTO_GIT` | `true` | Set `false` to disable auto-commit |

---

## Checking what changed

```bash
git log --oneline research-results/
git diff HEAD~1 research-results/best-soap-for-acne-prone-skin.md
```
