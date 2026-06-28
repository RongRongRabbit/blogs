const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const zennDir = path.join(root, "articles");
const docusaurusDir = path.join(root, "site", "blog");
const tagsFile = path.join(docusaurusDir, "tags.yml");

fs.mkdirSync(docusaurusDir, { recursive: true });

function parseTopics(fm) {
  const inlineMatch = fm.match(/topics:\s*\[(.*?)\]/m);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(",")
      .map((t) => t.replace(/["'\s]/g, ""))
      .filter(Boolean);
  }

  const blockMatch = fm.match(/topics:\s*\n((?:\s*-\s*.+\n?)+)/m);
  if (blockMatch) {
    return blockMatch[1]
      .split("\n")
      .map((line) => line.match(/-\s*(.+)/)?.[1])
      .filter(Boolean)
      .map((t) => t.replace(/["'\s]/g, ""));
  }

  return ["aws"];
}

function parseTitle(fm, file) {
  return fm.match(/title:\s*["']?(.+?)["']?$/m)?.[1] ?? file.replace(".md", "");
}

function parseDate(fm) {
  return fm.match(/date:\s*["']?(\d{4}-\d{2}-\d{2})["']?$/m)?.[1] ?? new Date().toISOString().slice(0, 10);
}

function readExistingTagKeys() {
  if (!fs.existsSync(tagsFile)) {
    return new Set();
  }

  const raw = fs.readFileSync(tagsFile, "utf8");
  const keys = raw
    .split("\n")
    .map((line) => line.match(/^([a-zA-Z0-9_-]+):\s*$/)?.[1])
    .filter(Boolean);

  return new Set(keys);
}

function appendMissingTags(allTopics) {
  const existing = readExistingTagKeys();
  const missing = [...allTopics].filter((tag) => !existing.has(tag));

  if (missing.length === 0) {
    return;
  }

  const appendText =
    "\n" +
    missing
      .map(
        (tag) => `${tag}:
  label: ${tag}
  permalink: /${tag}
  description: ${tag} tag description
`
      )
      .join("\n");

  fs.appendFileSync(tagsFile, appendText);
  console.log(`Added tags: ${missing.join(", ")}`);
}

const files = fs.readdirSync(zennDir).filter((file) => file.endsWith(".md"));
const allTopics = new Set();

for (const file of files) {
  const raw = fs.readFileSync(path.join(zennDir, file), "utf8");

  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    console.warn(`Skip: ${file}`);
    continue;
  }

  const fm = match[1];
  const body = match[2].trimStart();

  const title = parseTitle(fm, file);
  const topics = parseTopics(fm);
  topics.forEach((tag) => allTopics.add(tag));

  const slug = file.replace(/\.md$/, "");
  const date = parseDate(fm);
  const outputFile = `${date}-${slug}.md`;

  const docusaurusFm = `---
slug: ${slug}
title: ${title}
authors: [song]
tags:
${topics.map((t) => `  - ${t}`).join("\n")}
---

`;

  fs.writeFileSync(path.join(docusaurusDir, outputFile), docusaurusFm + body);
  console.log(`Synced: ${file} -> ${outputFile}`);
}

appendMissingTags(allTopics);