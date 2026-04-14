import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { research } from "./engine.mjs";

const QUESTIONS_DIR = "./questions";
const PROCESSED_DIR = "./questions/processed";
const RESULTS_DIR = "./research-results";
const LOGS_DIR = "./logs";

async function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  process.stdout.write(line);
  const logFile = path.join(LOGS_DIR, `run-${new Date().toISOString().slice(0, 10)}.log`);
  await fs.appendFile(logFile, line);
}

async function run() {
  await log("Research loop starting...");

  const files = (await fs.readdir(QUESTIONS_DIR)).filter(
    (f) => f.endsWith(".md")
  );

  if (files.length === 0) {
    await log("No question files found. Exiting.");
    return;
  }

  for (const file of files) {
    const filePath = path.join(QUESTIONS_DIR, file);
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");

    if (!lines[0].startsWith("# Topic")) {
      await log(`Skipping ${file} — missing '# Topic' header`);
      continue;
    }

    const topic = lines.slice(1).join("\n").trim();
    await log(`Researching: ${topic}`);

    try {
      const result = await research(topic);
      const outputFile = path.join(RESULTS_DIR, file);
      const outputContent = `# Research: ${topic}\n\n_Generated: ${new Date().toISOString()}_\n\n---\n\n${result}`;
      await fs.writeFile(outputFile, outputContent);
      await log(`Result written to ${outputFile}`);

      // Move to processed
      await fs.rename(filePath, path.join(PROCESSED_DIR, file));
      await log(`Moved ${file} to processed/`);
    } catch (err) {
      await log(`ERROR processing ${file}: ${err.message}`);
    }
  }

  await log("Research loop complete.");
}

run();
