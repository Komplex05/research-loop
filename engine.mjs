import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import readline from "readline";

export const client = new Anthropic();
export const MODEL = "claude-sonnet-4-6";

// ── Prompts ────────────────────────────────────────────────────────────────

export const PROMPTS = {
  clarify: `You are a research assistant preparing to research a topic for a specific person.
Read the topic and any context they have provided. Identify what personal information would
meaningfully change your research recommendations. Ask only essential questions — maximum 5,
minimum 1. Do not ask about things already answered in the context.

Respond ONLY as a JSON array of question strings. Example:
["What is your skin type?", "Are you looking for drugstore or prescription options?"]`,

  research: `You are a rigorous research assistant. Research the given topic thoroughly for this specific person profile.
Include key findings, nuances, caveats, and source quality notes (scientific study, clinical consensus, anecdotal, marketing, etc).
Tailor everything to the person's profile — generic advice is not acceptable.
Start with: CONFIDENCE: <0-100>
Then a blank line, then your findings. No markdown headers. Clean prose only.`,

  critique: `You are an adversarial fact-checker. Attack the research summary:
- Unsupported or overgeneralized claims
- Marketing language disguised as fact
- Missing nuance given the person's specific profile
- Counterevidence or dissenting expert opinion omitted
- Anything conflicting with established science
Start with: CONFIDENCE: <0-100>
Then a blank line, then your critique. No markdown headers. Be ruthless but accurate.`,

  refine: `You are a research synthesizer. Produce a final practical answer that:
- Keeps what survived scrutiny
- Corrects or qualifies challenged claims
- Is specifically tailored to the person's profile
- Is honest about uncertainty
Start with: CONFIDENCE: <0-100>
Then a blank line, then your refined answer. No markdown headers. Direct and actionable.`,

  compare: `You are a research analyst comparing two versions of research on the same topic for the same person.
Determine if there has been a MEANINGFUL change — not just rewording, but a genuine shift in:
- Core recommendations
- New evidence that changes advice
- Previously unknown risks or benefits
- Significant confidence change (10+ points)

Respond ONLY as JSON:
{
  "changed": true/false,
  "summary": "one sentence explaining what changed or why it's the same",
  "significance": "high/medium/low/none"
}`,
};

// ── Helpers ────────────────────────────────────────────────────────────────

export function parseConfidence(text) {
  const match = text.match(/^CONFIDENCE:\s*(\d+)/i);
  const confidence = match ? parseInt(match[1]) : 50;
  const body = text.replace(/^CONFIDENCE:\s*\d+\s*/i, "").trim();
  return { confidence, body };
}

export function confLabel(n) {
  if (n >= 80) return "HIGH";
  if (n >= 60) return "MEDIUM";
  if (n >= 40) return "LOW";
  return "VERY LOW";
}

export async function callClaude(systemPrompt, userMessage, { silent = false } = {}) {
  if (!silent) process.stdout.write("  Working");
  const interval = silent ? null : setInterval(() => process.stdout.write("."), 800);
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    if (interval) clearInterval(interval);
    if (!silent) process.stdout.write("\n");
    return res.content.map((b) => b.text || "").join("");
  } catch (e) {
    if (interval) clearInterval(interval);
    if (!silent) process.stdout.write("\n");
    throw e;
  }
}

// ── Question file parser ───────────────────────────────────────────────────

export function parseQuestionFile(filepath) {
  const raw = fs.readFileSync(filepath, "utf8");
  const get = (tag) => {
    const match = raw.match(new RegExp(`#\\s*${tag}\\s*\\n([\\s\\S]*?)(?=\\n#|$)`, "i"));
    return match ? match[1].trim() : null;
  };

  const topic = get("Topic");
  const context = get("Context");
  const questionsRaw = get("Questions");
  const answersRaw = get("Answers");
  const stable = /^#\s*Stable/im.test(raw);
  const refresh = /^#\s*Refresh:\s*true/im.test(raw);

  // Parse profile (answered clarifications stored as key: value lines)
  const profileRaw = get("Profile");
  const profile = {};
  if (profileRaw) {
    for (const line of profileRaw.split("\n")) {
      const m = line.match(/^-?\s*(.+?):\s*(.+)$/);
      if (m) profile[m[1].trim()] = m[2].trim();
    }
  }

  // Parse pending questions (lines starting with -)
  const pendingQuestions = questionsRaw
    ? questionsRaw.split("\n").filter(l => l.match(/^-\s+/)).map(l => l.replace(/^-\s+/, "").trim())
    : [];

  return { topic, context, pendingQuestions, profile, stable, refresh, raw, filepath };
}

export function writeQuestionFile(filepath, data) {
  let content = `# Topic\n${data.topic}\n`;

  if (data.context) content += `\n# Context\n${data.context}\n`;

  if (Object.keys(data.profile).length > 0) {
    content += `\n# Profile\n`;
    for (const [k, v] of Object.entries(data.profile)) {
      content += `- ${k}: ${v}\n`;
    }
  }

  if (data.pendingQuestions.length > 0) {
    content += `\n# Questions\n`;
    for (const q of data.pendingQuestions) content += `- ${q}\n`;
  }

  if (data.stable && !data.refresh) content += `\n# Stable\n`;
  if (data.refresh) content += `\n# Refresh: true\n`;

  fs.writeFileSync(filepath, content, "utf8");
}

// ── Clarification interview ────────────────────────────────────────────────

export async function runClarification(questionData) {
  const { topic, context, profile } = questionData;

  const contextStr = [
    context ? `Context provided: ${context}` : "",
    Object.keys(profile).length > 0
      ? `Already known: ${Object.entries(profile).map(([k,v]) => `${k}: ${v}`).join(", ")}`
      : "",
  ].filter(Boolean).join("\n");

  const raw = await callClaude(
    PROMPTS.clarify,
    `Topic: ${topic}\n${contextStr}`,
    { silent: true }
  );

  let questions;
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    questions = JSON.parse(clean);
  } catch {
    return profile; // if parsing fails, proceed with what we have
  }

  if (!questions.length) return profile;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(`  ${q}\n  > `, resolve));

  console.log("\n  Before researching, I have a few questions:\n");
  const updatedProfile = { ...profile };

  for (const q of questions) {
    const answer = await ask(q);
    if (answer.trim()) {
      updatedProfile[q] = answer.trim();
    }
  }

  rl.close();
  return updatedProfile;
}

// ── Research loop ──────────────────────────────────────────────────────────

export async function runResearchLoop(topic, profile, rounds = 1) {
  const profileStr = Object.entries(profile)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  let currentSummary = "";
  let currentCritique = "";
  const allPasses = [];

  for (let r = 1; r <= rounds; r++) {
    if (rounds > 1) console.log(`\n  ── Round ${r} of ${rounds} ──`);

    console.log(`\n📖 Research pass${rounds > 1 ? ` (round ${r})` : ""}...`);
    const resPrompt = r === 1
      ? `Topic: ${topic}\n\nPerson profile:\n${profileStr}`
      : `Topic: ${topic}\n\nPerson profile:\n${profileStr}\n\nPrevious summary:\n${currentSummary}\n\nPrevious critique:\n${currentCritique}\n\nDo a fresh improved pass.`;

    const resRaw = await callClaude(PROMPTS.research, resPrompt);
    const res = parseConfidence(resRaw);
    currentSummary = res.body;
    allPasses.push({ type: "research", round: r, ...res });
    console.log(`  Confidence: ${res.confidence}% (${confLabel(res.confidence)})\n\n${res.body}`);

    console.log(`\n🔍 Critique pass${rounds > 1 ? ` (round ${r})` : ""}...`);
    const critRaw = await callClaude(
      PROMPTS.critique,
      `Topic: ${topic}\n\nPerson profile:\n${profileStr}\n\nResearch to critique:\n${currentSummary}`
    );
    const crit = parseConfidence(critRaw);
    currentCritique = crit.body;
    allPasses.push({ type: "critique", round: r, ...crit });
    console.log(`  Revised confidence: ${crit.confidence}% (${confLabel(crit.confidence)})\n\n${crit.body}`);
  }

  console.log(`\n✅ Final synthesis...`);
  const refRaw = await callClaude(
    PROMPTS.refine,
    `Topic: ${topic}\n\nPerson profile:\n${profileStr}\n\nResearch:\n${currentSummary}\n\nCritique:\n${currentCritique}`
  );
  const ref = parseConfidence(refRaw);
  allPasses.push({ type: "final", ...ref });
  console.log(`  Final confidence: ${ref.confidence}% (${confLabel(ref.confidence)})\n\n${ref.body}`);

  return allPasses;
}

// ── Change detection ───────────────────────────────────────────────────────

export async function detectChange(topic, previousFinalAnswer, newFinalAnswer) {
  console.log(`\n🔎 Comparing against previous findings...`);
  const raw = await callClaude(
    PROMPTS.compare,
    `Topic: ${topic}\n\nPREVIOUS:\n${previousFinalAnswer}\n\nNEW:\n${newFinalAnswer}`,
    { silent: true }
  );
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return { changed: false, summary: "Could not determine", significance: "none" };
  }
}

// ── Result file helpers ────────────────────────────────────────────────────

export function getResultPath(outputDir, topic) {
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  return path.join(outputDir, `${slug}.md`);
}

export function extractLastFinalAnswer(resultContent) {
  const sections = resultContent.split("---");
  const last = sections[sections.length - 1];
  const match = last.match(/## Final Answer[\s\S]*?\*\*Final Confidence[^*]+\*\*\s*\n\n([\s\S]+?)(?=\n\n##|\n\n---|\s*$)/);
  return match ? match[1].trim() : null;
}

export function buildResultEntry(passes, profile, isFirstRun, changeInfo = null) {
  const ts = new Date().toLocaleString();
  const profileStr = Object.entries(profile).map(([k,v]) => `- ${k}: ${v}`).join("\n");
  let md = `\n---\n\n## Run: ${ts}\n\n`;

  if (changeInfo && !isFirstRun) {
    if (changeInfo.changed) {
      md += `> ⚠️ CHANGED — ${changeInfo.summary}\n\n`;
    } else {
      md += `> ✅ NO CHANGE — ${changeInfo.summary}\n\n`;
    }
  }

  md += `**Profile:**\n${profileStr}\n\n`;

  for (const pass of passes) {
    if (pass.type === "research") {
      md += `### Research (Round ${pass.round})\n**Confidence: ${pass.confidence}% (${confLabel(pass.confidence)})**\n\n${pass.body}\n\n`;
    } else if (pass.type === "critique") {
      md += `### Critique (Round ${pass.round})\n**Revised Confidence: ${pass.confidence}% (${confLabel(pass.confidence)})**\n\n${pass.body}\n\n`;
    } else if (pass.type === "final") {
      md += `### Final Answer\n**Final Confidence: ${pass.confidence}% (${confLabel(pass.confidence)})**\n\n${pass.body}\n\n`;
    }
  }

  return md;
}
