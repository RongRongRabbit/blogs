const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const zennDir = path.join(root, "articles");
const docusaurusDir = path.join(root, "site", "blog");

fs.mkdirSync(docusaurusDir, { recursive: true });

const files = fs.readdirSync(zennDir).filter((file) => file.endsWith(".md"));

for (const file of files) {
  const raw = fs.readFileSync(path.join(zennDir, file), "utf8");

  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    console.warn(`Skip: ${file}`);
    continue;
  }

  const fm = match[1];
  const body = match[2].trimStart();

  const title = fm.match(/title:\s*["']?(.+?)["']?$/m)?.[1] ?? file.replace(".md", "");

  const topicsLine = fm.match(/topics:\s*\[(.*?)\]/m);
  const topics = topicsLine
    ? topicsLine[1]
        .split(",")
        .map((t) => t.replace(/["'\s]/g, ""))
        .filter(Boolean)
    : ["aws"];

  const slug = file.replace(/\.md$/, "");

  const docusaurusFm = `---
slug: ${slug}
title: ${title}
authors: [song]
tags:
${topics.map((t) => `  - ${t}`).join("\n")}
---

`;

  fs.writeFileSync(path.join(docusaurusDir, file), docusaurusFm + body);
  console.log(`Synced: ${file}`);
}