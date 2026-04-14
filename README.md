# Research Loop

Automated research agent powered by Claude. Drop a question file in `questions/`, run the script, get a Markdown summary in `research-results/`.

## Setup

```bash
npm install
cp .env.example .env  # add your ANTHROPIC_API_KEY
```

## Usage

```bash
node run.mjs
```

## Question Format

Files in `questions/` must follow this format:

```markdown
# Topic
your topic or question here
```

## Output

Results are saved to `research-results/<filename>.md`. Processed question files are moved to `questions/processed/`.

## Automate with Cron

```cron
0 8 * * * cd /path/to/research-loop && node run.mjs >> logs/cron.log 2>&1
```
