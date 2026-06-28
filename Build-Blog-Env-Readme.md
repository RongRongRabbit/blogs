# GitHub Pages + Zenn ブログ環境構築メモ

## 目的

AWS / OCI / Cloud / Security / Automation などの技術記事を、Zenn と GitHub Pages の両方で公開できるブログ環境を構築する。

最終的な運用方針は以下。


articles/ に記事を書く
↓
git push
↓
GitHub Actions が自動同期
↓
Zenn に反映
↓
Docusaurus / GitHub Pages にも反映


---

## 全体構成


blogs/
├── articles/        # Zenn 用の記事。唯一メンテナンスする原稿
├── books/           # Zenn books 用。現在は未使用
├── drafts/          # 下書き管理
│   ├── raw/
│   ├── sanitized/
│   └── ready/
├── prompts/         # ChatGPT 用プロンプト
├── scripts/         # 自動同期スクリプト
│   └── sync-zenn-to-docusaurus.js
├── site/            # Docusaurus / GitHub Pages
│   ├── blog/
│   ├── docs/
│   ├── src/
│   ├── static/
│   └── package.json
├── .github/
│   └── workflows/
│       ├── deploy.yml
│       └── sync-blog.yml
├── README.md
└── LICENSE


---

## 使用するサービス

* GitHub
* GitHub Pages
* GitHub Actions
* Docusaurus
* Zenn
* ChatGPT

---

## 事前準備

Mac に以下がインストール済みであることを確認する。

bash
git --version
node -v
npm -v


---

## GitHub リポジトリ作成

GitHub で新規リポジトリを作成。

例：


Repository name: blogs
Description: AWS Engineering Blog and Knowledge Base
Visibility: Public
README: Add
.gitignore: Node
License: MIT


ローカルに clone。

bash
cd ~/Github
git clone https://github.com/<GitHubユーザー名>/blogs.git
cd blogs


---

## Git ユーザー設定

bash
git config --global user.name "Rongrong Tu"
git config --global user.email "<GitHub noreply email>"


確認。

bash
git config --global --list


---

## Docusaurus 初期化

リポジトリ直下で実行。

bash
cd ~/Github/blogs
npx create-docusaurus@latest site classic


言語選択では JavaScript を選択。


JavaScript


起動確認。

bash
cd site
npm start


ブラウザで確認。


http://localhost:3000


ポートが使用中の場合は、別ポートで起動される。

例：


http://localhost:3001
http://localhost:3003/blogs/


---

## Docusaurus の初期記事削除

Docusaurus のサンプル記事は不要なため削除。

bash
cd ~/Github/blogs/site/blog
rm -f 2017-*.md
rm -f 2019-*.md
rm -f 2021-08-01-*.md
rm -rf 2021-08-26-welcome


---

## author 設定

Docusaurus の blog author を設定する。

bash
code ~/Github/blogs/site/blog/authors.yml


例：

yaml
song:
  name: Song
  title: AWS Jr. Champion 2026 | Cloud Infrastructure Engineer
  url: https://github.com/RongRongRabbit
  image_url: https://github.com/RongRongRabbit.png


記事側では以下のように指定する。

yaml
authors: [song]


---

## GitHub Pages 設定

GitHub リポジトリの Settings で設定。


Settings
→ Pages
→ Build and deployment
→ Source
→ GitHub Actions


Custom domain は空欄でよい。

---

## Docusaurus GitHub Pages 用設定

site/docusaurus.config.js を確認。

js
url: 'https://<GitHubユーザー名>.github.io',
baseUrl: '/blogs/',
organizationName: '<GitHubユーザー名>',
projectName: 'blogs',


例：

js
url: 'https://RongRongRabbit.github.io',
baseUrl: '/blogs/',
organizationName: 'RongRongRabbit',
projectName: 'blogs',


---

## GitHub Pages deploy workflow

作成。

bash
mkdir -p ~/Github/blogs/.github/workflows
code ~/Github/blogs/.github/workflows/deploy.yml


内容。

yaml
name: Deploy GitHub Pages

on:
  push:
    branches:
      - main

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: site

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: site/package-lock.json

      - run: npm ci
      - run: npm run build

      - uses: actions/upload-pages-artifact@v3
        with:
          path: site/build

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}

    steps:
      - id: deployment
        uses: actions/deploy-pages@v4


---

## Zenn 用ディレクトリ作成

Zenn GitHub 連携では、リポジトリ直下に articles/ と books/ が必要。

bash
cd ~/Github/blogs
mkdir -p articles books
touch articles/.keep
touch books/.keep


正しい構成。


blogs/
├── articles/
├── books/
└── site/


間違った構成。


blogs/
└── zenn/
    ├── articles/
    └── books/


Zenn はリポジトリ直下しか見ないため、zenn/articles では認識されない。

---

## Zenn GitHub 連携

Zenn にログイン。


Settings
→ GitHub連携
→ Repository 選択


対象リポジトリを選択。


RongRongRabbit/blogs


Zenn username は変更不可のため慎重に設定する。

今回の方針。


Username: takuyousou
Display Name: Song


---

## Zenn 記事 Front Matter

Zenn 側の記事は articles/ に作成する。

例：


articles/aws-jr-champions-2026.md


Front Matter 例。

yaml
---
title: "2026 Japan AWS Jr. Champions に選出されるまでに取り組んだこと"
emoji: "☁️"
type: "tech"
topics:
  - aws
  - jrchampion
  - cloud
  - community
published: true
date: "2026-06-28"
---


注意点。

* published: false の場合は Zenn に公開されない
* published: true で公開
* date は Docusaurus 側のファイル名生成に利用
* topics は Docusaurus 側では tags に変換する

---

## Zenn 記事から Docusaurus 記事へ自動同期する方針

Zenn 原稿を唯一のメンテナンス対象にする。


articles/aws-jr-champions-2026.md
↓
scripts/sync-zenn-to-docusaurus.js
↓
site/blog/2026-06-28-aws-jr-champions-2026.md


Docusaurus 側では以下の Front Matter に変換される。

yaml
---
slug: aws-jr-champions-2026
title: 2026 Japan AWS Jr. Champions に選出されるまでに取り組んだこと
authors: [song]
tags:
  - aws
  - jrchampion
  - cloud
  - community
---


---

## 同期スクリプト作成

bash
cd ~/Github/blogs
mkdir -p scripts
code scripts/sync-zenn-to-docusaurus.js


内容。

js
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
        (tag) => ${tag}:
  label: ${tag}
  permalink: /${tag}
  description: ${tag} tag description

      )
      .join("\n");

  fs.appendFileSync(tagsFile, appendText);
  console.log(Added tags: ${missing.join(", ")});
}

const files = fs.readdirSync(zennDir).filter((file) => file.endsWith(".md"));
const allTopics = new Set();

for (const file of files) {
  const raw = fs.readFileSync(path.join(zennDir, file), "utf8");

  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    console.warn(Skip: ${file});
    continue;
  }

  const fm = match[1];
  const body = match[2].trimStart();

  const title = parseTitle(fm, file);
  const topics = parseTopics(fm);
  topics.forEach((tag) => allTopics.add(tag));

  const slug = file.replace(/\.md$/, "");
  const date = parseDate(fm);
  const outputFile = ${date}-${slug}.md;

  const docusaurusFm = ---
slug: ${slug}
title: ${title}
authors: [song]
tags:
${topics.map((t) =>   - ${t}).join("\n")}
---

;

  fs.writeFileSync(path.join(docusaurusDir, outputFile), docusaurusFm + body);
  console.log(Synced: ${file} -> ${outputFile});
}

appendMissingTags(allTopics);


---

## site/package.json に同期コマンド追加

編集。

bash
code ~/Github/blogs/site/package.json


scripts に sync:blog を追加。

json
"scripts": {
  "docusaurus": "docusaurus",
  "start": "docusaurus start",
  "build": "docusaurus build",
  "swizzle": "docusaurus swizzle",
  "deploy": "docusaurus deploy",
  "clear": "docusaurus clear",
  "serve": "docusaurus serve",
  "write-translations": "docusaurus write-translations",
  "write-heading-ids": "docusaurus write-heading-ids",
  "sync:blog": "node ../scripts/sync-zenn-to-docusaurus.js"
}


注意。

* 既存の Docusaurus コマンドは削除しない
* package.json は site/ 配下にある
* スクリプトは blogs/scripts/ にある
* そのためパスは ../scripts/sync-zenn-to-docusaurus.js

---

## 手動同期確認

bash
cd ~/Github/blogs/site
npm run sync:blog


成功例。


Synced: aws-jr-champions-2026.md -> 2026-06-28-aws-jr-champions-2026.md


確認。

bash
ls ~/Github/blogs/site/blog


例。


2026-06-28-aws-jr-champions-2026.md
authors.yml
tags.yml


---

## Docusaurus ローカル確認

bash
cd ~/Github/blogs/site
npm start


ブラウザで確認。


http://localhost:3000


または baseUrl により以下の場合もある。


http://localhost:3000/blogs/


---

## Docusaurus キャッシュエラー対応

以下のようなエラーが出る場合がある。


.docusaurus/registry.js
node_modules/.cache/rspack
persistent cache save failed


対応。

bash
cd ~/Github/blogs/site
rm -rf .docusaurus
rm -rf node_modules/.cache
npm start


それでも直らない場合。

bash
npm run clear
npm start


---

## truncation marker warning 対応

Docusaurus で以下 warning が出る場合。


Docusaurus found blog posts without truncation markers


記事の導入部分の後に追加する。

md
<!-- truncate -->


例。

md
これから応募を考えている方の参考になれば嬉しいです。

<!-- truncate -->


---

## tags.yml warning 対応

Docusaurus で以下 warning が出る場合。


Tags [jrchampion, cloud, community] are not defined in tags.yml


同期スクリプトで site/blog/tags.yml に自動追加するようにした。

例。

yaml
cloud:
  label: cloud
  permalink: /cloud
  description: cloud tag description


---

## GitHub Actions による自動同期

目的。


articles/ に記事を書く
↓
git push
↓
GitHub Actions が sync script を実行
↓
site/blog/ に Docusaurus 記事を自動生成
↓
自動 commit
↓
GitHub Pages deploy workflow が実行


---

## sync-blog workflow

作成。

bash
code ~/Github/blogs/.github/workflows/sync-blog.yml


内容。

yaml
name: Sync Zenn articles to Docusaurus

on:
  push:
    branches:
      - main
    paths:
      - "articles/**"
      - "scripts/**"

permissions:
  contents: write

jobs:
  sync:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Run sync script
        run: node scripts/sync-zenn-to-docusaurus.js

      - name: Commit synced files
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "sync zenn articles to docusaurus"
          file_pattern: "site/blog/*.md site/blog/tags.yml"


---

## 自動同期後の流れ

articles/ を更新して push すると、以下が自動実行される。


1. Sync Zenn articles to Docusaurus
2. auto commit
3. Deploy GitHub Pages


GitHub Actions で確認。


GitHub Repository
→ Actions
→ Sync Zenn articles to Docusaurus
→ Deploy GitHub Pages


---

## 通常のブログ執筆フロー

今後は articles/ のみ編集する。

bash
cd ~/Github/blogs
code articles/new-article.md


記事を書く。

yaml
---
title: "記事タイトル"
emoji: "☁️"
type: "tech"
topics:
  - aws
  - security
published: false
date: "2026-07-01"
---


確認後、公開する場合。

yaml
published: true


push。

bash
git add .
git commit -m "publish new article"
git push


その後、自動で以下に反映される。


Zenn
GitHub Pages


---

## GitHub Pages 手動確認

GitHub Pages の URL。


https://<GitHubユーザー名>.github.io/blogs/


例。


https://RongRongRabbit.github.io/blogs/


---

## よくあるトラブル

### Zenn で articles ディレクトリが見つからない

原因。


articles/ が repository root にない


正しい構成。


blogs/articles/
blogs/books/


間違い。


blogs/zenn/articles/
blogs/zenn/books/


---

### Zenn に反映されない

確認項目。

bash
git status
git ls-files articles
git push


確認ポイント。

* articles/*.md が Git 管理されているか
* GitHub に push 済みか
* Zenn GitHub 連携が正しい repository を見ているか
* branch が main か
* published: true か

---

### Docusaurus で 2017 年の記事になる

原因。

Docusaurus blog に日付なしファイルが生成されている。

例。


site/blog/aws-jr-champions-2026.md


対策。

記事 front matter に date を入れる。

yaml
date: "2026-06-28"


同期スクリプトで以下のように変換する。


articles/aws-jr-champions-2026.md
↓
site/blog/2026-06-28-aws-jr-champions-2026.md


不要な日付なしファイルは削除。

bash
rm ~/Github/blogs/site/blog/aws-jr-champions-2026.md


---

### Tag が一部消える

原因。

Zenn の topics が block 形式の場合、古いスクリプトでは正しく読めない。

block 形式。

yaml
topics:
  - aws
  - jrchampion
  - cloud
  - community


対応。

parseTopics() で inline 形式と block 形式の両方に対応する。

---

## Commit message 例

初期構築。

bash
git commit -m "init docusaurus site"


GitHub Pages workflow 追加。

bash
git commit -m "add github pages deployment workflow"


Zenn ディレクトリ移動。

bash
git commit -m "move zenn articles to repository root"


同期スクリプト追加。

bash
git commit -m "add zenn to docusaurus sync script"


自動同期 workflow 追加。

bash
git commit -m "add automatic blog sync workflow"


記事公開。

bash
git commit -m "publish aws jr champions article"


---

## 現在の運用ルール

* 原稿は articles/ にのみ書く
* site/blog/ は基本的に自動生成先
* published: true で Zenn 公開
* date は必ず入れる
* topics は Zenn / Docusaurus 両方で利用
* GitHub Pages は GitHub Actions で自動 deploy
* 手動で site/blog/ を編集しない

---

## 今後やりたい改善

* published: false の記事は GitHub Pages にも出さない
* articles/ から削除された記事を site/blog/ からも自動削除
* GitHub Pages 版に Related Links を自動追加
* Zenn URL を GitHub Pages 側に自動追加
* ChatGPT 用ブログ生成テンプレートを prompts/ に整備
* 記事公開前の脱敏チェックリストを自動化
* Markdown lint / front matter check を GitHub Actions に追加
