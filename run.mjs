#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import {
  parseQuestionFile, writeQuestionFile,
  runClarification, runResearchLoop,
  detectChange, getResultPath,
  extractLastFinalAnswer, buildResultEntry,
  confLabel,
} from "./engine.mjs";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const QUESTIONS_DIR = path.join(ROOT, "questions");
const PROCESSED_DIR = path.join(ROOT, "questions", "processed");
const RESULTS_DIR = path.join(ROOT, "research-results");
const ROUNDS = parseInt(process.env.RESEARCH_ROUNDS || "1");
const AUTO_GIT = process.env.AUTO_GIT !== "false";

// ── Git helpers ────────────────────────────────────────────────────────────

function gitCommit(message, files) {
  if (!AUTO_GIT) return;
  try {
    for (const f of files) execSync(`git add "${f}"`, { cwd: ROOT, stdio: "pipe" });
    execSync(`git commit -m "${message}"`, { cwd: ROOT, stdio: "pipe" });
    try { execSync("git push", { cwd: ROOT, stdio: "pipe" }); } catch {}
  } catch (e) {
    // git not set up — silently skip
  }
}

// ── Process a single topic ─────────────────────────────────────────────────

async function processTopic(qFile) {
  const qPath = path.join(QUESTIONS_DIR, qFile);
  let qData = parseQuestionFile(qPath);

  if (!qData.topic) {
    console.log(`  ⚠️  Skipping ${qFile} — no Topic found`);
    return;
  }

  const resultPath = getResultPath(RESULTS_DIR, qData.topic);
  const isFirstRun = !fs.existsSync(resultPath);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Topic: ${qData.topic}`);
  console.log(`  Status: ${isFirstRun ? "first run" : qData.stable ? "STABLE — checking for refresh tag" : "re-running"}`);
  console.log(`${"═".repeat(60)}`);

  // Handle refresh tag — reset stable, clear profile if requested
  if (qData.refresh) {
    console.log(`\n  🔄 Refresh tag found — resetting STABLE status and re-interviewing`);
    qData.stable = false;
    qData.profile = {};
    // Remove refresh tag from file
    qData.refresh = false;
    writeQuestionFile(qPath, qData);
  }

  // Skip stable topics
  if (qData.stable && !isFirstRun) {
    console.log(`\n  ⏭️  Topic is STABLE — skipping. Add "# Refresh: true" to re-run.\n`);
    return;
  }

  // Step 1: Clarification (only if profile is incomplete or first run)
  const needsClarification = isFirstRun || Object.keys(qData.profile).length === 0;
  if (needsClarification) {
    console.log(`\n💬 Clarification interview...`);
    const updatedProfile = await runClarification(qData);
    qData.profile = updatedProfile;
    writeQuestionFile(qPath, qData);
    console.log(`\n  Profile saved.`);
    gitCommit(`profile: ${qData.topic}`, [qPath]);
  } else {
    console.log(`\n  Using existing profile: ${Object.entries(qData.profile).map(([k,v]) => `${k}: ${v}`).join(", ")}`);
  }

  // Step 2: Research loop
  const passes = await runResearchLoop(qData.topic, qData.profile, ROUNDS);
  const finalPass = passes.find(p => p.type === "final");

  // Step 3: Change detection (not on first run)
  let changeInfo = null;
  if (!isFirstRun) {
    const existingContent = fs.readFileSync(resultPath, "utf8");
    const previousFinal = extractLastFinalAnswer(existingContent);
    if (previousFinal) {
      changeInfo = await detectChange(qData.topic, previousFinal, finalPass.body);
      console.log(`\n  ${changeInfo.changed ? "⚠️  CHANGED" : "✅ No change"} — ${changeInfo.summary}`);

      // Mark stable if no meaningful change
      if (!changeInfo.changed) {
        qData.stable = true;
        writeQuestionFile(qPath, qData);
        console.log(`  Topic marked STABLE — won't re-run until you add "# Refresh: true"`);
      }
    }
  }

  // Step 4: Answer any pending questions from the question file
  let qaSection = "";
  if (qData.pendingQuestions.length > 0) {
    console.log(`\n❓ Answering ${qData.pendingQuestions.length} pending question(s)...`);
    const { callClaude } = await import("./engine.mjs");
    const profileStr = Object.entries(qData.profile).map(([k,v]) => `- ${k}: ${v}`).join("\n");
    const researchContext = passes.filter(p => p.type === "final").map(p => p.body).join("\n");

    qaSection = "\n### Q&A\n\n";
    for (const q of qData.pendingQuestions) {
      console.log(`  Q: ${q}`);
      const answer = await callClaude(
        `You are a research assistant. Answer the follow-up question using the research context provided.
Be specific to the person's profile. If the research doesn't cover it, answer from general knowledge and say so.`,
        `Topic: ${qData.topic}\n\nPerson profile:\n${profileStr}\n\nResearch context:\n${researchContext}\n\nQuestion: ${q}`
      );
      qaSection += `**Q: ${q}**\n\n${answer.trim()}\n\n`;
    }

    // Clear pending questions — they've been answered
    qData.pendingQuestions = [];
    writeQuestionFile(qPath, qData);
  }

  // Step 5: Build and write result entry
  const entry = buildResultEntry(passes, qData.profile, isFirstRun, changeInfo) + qaSection;

  if (isFirstRun) {
    const header = `# Research: ${qData.topic}\n\n*Topic file: questions/${qFile}*\n`;
    fs.writeFileSync(resultPath, header + entry, "utf8");
  } else {
    fs.appendFileSync(resultPath, entry, "utf8");
  }

  console.log(`\n💾 Saved: ${path.relative(ROOT, resultPath)}`);

  // Step 6: Git commit
  const confidence = finalPass?.confidence ?? 0;
  const changeTag = changeInfo?.changed ? " [CHANGED]" : !isFirstRun ? " [no change]" : "";
  gitCommit(
    `research: ${qData.topic} [${confidence}% confidence]${changeTag}`,
    [resultPath, qPath]
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║        Research Loop — Daily Runner           ║");
  console.log(`║        ${new Date().toLocaleDateString().padEnd(38)}║`);
  console.log("╚══════════════════════════════════════════════╝");

  // Ensure dirs exist
  for (const d of [QUESTIONS_DIR, PROCESSED_DIR, RESULTS_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  // Find all question files
  const qFiles = fs.readdirSync(QUESTIONS_DIR)
    .filter(f => f.endsWith(".md") && fs.statSync(path.join(QUESTIONS_DIR, f)).isFile());

  if (!qFiles.length) {
    console.log("\n  No question files found in questions/");
    console.log("  Create a .md file with:\n");
    console.log("    # Topic");
    console.log("    your research topic here\n");
    process.exit(0);
  }

  console.log(`\n  Found ${qFiles.length} topic(s): ${qFiles.join(", ")}`);

  let processed = 0, skipped = 0, changed = 0;

  for (const qFile of qFiles) {
    try {
      const before = fs.existsSync(path.join(RESULTS_DIR, getResultPath(RESULTS_DIR,
        parseQuestionFile(path.join(QUESTIONS_DIR, qFile)).topic
      ).split("/").pop()))
        ? fs.readFileSync(path.join(RESULTS_DIR, getResultPath(RESULTS_DIR,
            parseQuestionFile(path.join(QUESTIONS_DIR, qFile)).topic
          ).split("/").pop()), "utf8")
        : null;

      await processTopic(qFile);
      processed++;

      const qData = parseQuestionFile(path.join(QUESTIONS_DIR, qFile));
      if (before && !qData.stable) changed++;

    } catch (e) {
      console.error(`\n  ❌ Error processing ${qFile}: ${e.message}`);
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Done. ${processed} processed, ${skipped} skipped, ${changed} changed.`);
  console.log(`${"─".repeat(60)}\n`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
