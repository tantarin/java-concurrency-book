import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";

const root = process.cwd();
const out = path.join(root, "docs");
const base = "/java-concurrency-book/";
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const escapeHtml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const slugify = (value) => value.toLowerCase().replace(/[^a-zа-яё0-9\s-]/gi, "").trim().replace(/\s+/g, "-");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const tocPattern = /^\d+\. \[([^\]]+)\]\(\.\/chapters\/([^\)]+)\) — (.+)$/gm;
const chapters = [...read("README.md").matchAll(tocPattern)].map((match, index) => ({
  number: index + 1,
  title: match[1],
  file: match[2],
  slug: match[2].replace(/\.md$/, ""),
  summary: match[3]
}));

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const hrefIndex = token.attrIndex("href");
  if (hrefIndex >= 0) {
    let href = token.attrs[hrefIndex][1];
    if (/^(\.\/|\.\.\/)?chapters\//.test(href)) href = `${base}chapters/${path.basename(href, ".md")}/`;
    else if (/^\.\/[^/]+\.md(#.*)?$/.test(href)) href = `${base}chapters/${href.slice(2).replace(/\.md(?=#|$)/, "/")}`;
    else if (/^\.\.\/README\.md/.test(href)) href = base;
    else if (/^\.\/[^/]+\.md/.test(href)) href = `${base}chapters/${path.basename(href, ".md")}/`;
    token.attrs[hrefIndex][1] = href;
    if (/^https?:/.test(href)) token.attrSet("target", "_blank");
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};
const defaultHeadingOpen = md.renderer.rules.heading_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const inline = tokens[idx + 1];
  if (inline?.content) tokens[idx].attrSet("id", slugify(inline.content));
  return defaultHeadingOpen(tokens, idx, options, env, self);
};

function stripDocumentNavigation(source) {
  return source
    .replace(/^← \[Оглавление\].*→\s*$/gm, "")
    .replace(/^---\s*\n← \[Оглавление\][\s\S]*$/m, "")
    .trim();
}

function shell({ title, description, content, current = null, pageClass = "" }) {
  const nav = chapters.map((chapter) => `<a class="chapter-link${current === chapter.slug ? " active" : ""}" href="${base}chapters/${chapter.slug}/"><span>${String(chapter.number).padStart(2, "0")}</span><div>${escapeHtml(chapter.title)}<small>${escapeHtml(chapter.summary)}</small></div></a>`).join("");
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Многопоточность в Java</title><meta name="description" content="${escapeHtml(description)}">
<link rel="stylesheet" href="${base}assets/style.css"><link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml">
</head><body class="${pageClass}">
<div class="reading-progress" id="reading-progress"></div>
<header class="topbar"><a class="brand" href="${base}"><span class="brand-mark">//</span><span>Java<br><b>Concurrency</b></span></a><button class="menu-button" id="menu-button" aria-label="Открыть оглавление">Оглавление</button><div class="top-actions"><button id="theme-button" class="icon-button" aria-label="Переключить тему">◐</button><a href="https://github.com/tantarin/java-concurrency-book" target="_blank">GitHub ↗</a></div></header>
<aside class="sidebar" id="sidebar"><div class="sidebar-head"><p>Учебный маршрут</p><button id="close-menu" aria-label="Закрыть">×</button></div><label class="search"><span>⌕</span><input id="search" type="search" placeholder="Найти тему или главу"></label><nav id="chapter-nav">${nav}</nav><a class="glossary-link" href="${base}glossary/">Aa&nbsp;&nbsp;Словарь терминов</a></aside>
<main class="main ${pageClass}">${content}</main>
<script>window.SITE_BASE=${JSON.stringify(base)};window.CHAPTERS=${JSON.stringify(chapters)};</script><script src="${base}assets/app.js"></script></body></html>`;
}

const rendered = chapters.map((chapter) => {
  const source = stripDocumentNavigation(read(`chapters/${chapter.file}`));
  return { ...chapter, source, html: md.render(source), plain: source.replace(/[`*_>#\[\]()|-]/g, " ").replace(/\s+/g, " ") };
});

for (const chapter of rendered) {
  const prev = rendered[chapter.number - 2];
  const next = rendered[chapter.number];
  const pager = `<nav class="pager">${prev ? `<a href="${base}chapters/${prev.slug}/"><span>← Предыдущая</span>${escapeHtml(prev.title)}</a>` : "<i></i>"}${next ? `<a class="next" href="${base}chapters/${next.slug}/"><span>Следующая →</span>${escapeHtml(next.title)}</a>` : `<a class="next" href="${base}"><span>Готово</span>Вернуться к маршруту</a>`}</nav>`;
  const article = `<article><div class="chapter-meta"><span>Глава ${chapter.number} из ${chapters.length}</span><span>${Math.max(1, Math.round(chapter.plain.split(" ").length / 180))} мин чтения</span></div>${chapter.html}${pager}</article>`;
  const dir = path.join(out, "chapters", chapter.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), shell({ title: chapter.title, description: chapter.summary, content: article, current: chapter.slug, pageClass: "reader" }));
}

const cards = chapters.map((chapter) => `<a class="route-card" href="${base}chapters/${chapter.slug}/"><span>${String(chapter.number).padStart(2, "0")}</span><div><h3>${escapeHtml(chapter.title)}</h3><p>${escapeHtml(chapter.summary)}</p></div><b>→</b></a>`).join("");
const home = `<section class="hero"><div class="eyebrow">Открытый учебник · 30 глав</div><h1>Разберись,<br>как <em>думают потоки</em></h1><p>Последовательный курс по многопоточности в Java: от первого потока и race condition до Java Memory Model, конкурентных коллекций и виртуальных потоков.</p><div class="hero-actions"><a class="primary" href="${base}chapters/${chapters[0].slug}/">Начать обучение <span>→</span></a><a href="#route">Посмотреть программу</a></div><div class="code-art" aria-hidden="true"><span>Thread.ofVirtual()</span><strong>.start(task);</strong><i></i><i></i><i></i></div></section><section class="stats"><div><b>30</b><span>связанных глав</span></div><div><b>≈ 3 ч</b><span>на весь маршрут</span></div><div><b>Java</b><span>примеры из практики</span></div></section><section id="route" class="route"><div class="section-title"><span>01 — 30</span><div><h2>Учебный маршрут</h2><p>Иди по порядку: каждая следующая тема опирается на предыдущую.</p></div></div><div class="route-list">${cards}</div></section>`;
fs.writeFileSync(path.join(out, "index.html"), shell({ title: "Учебник", description: "Русскоязычный учебник по многопоточности в Java", content: home, pageClass: "home" }));

const glossary = md.render(read("GLOSSARY.md"));
fs.mkdirSync(path.join(out, "glossary"), { recursive: true });
fs.writeFileSync(path.join(out, "glossary", "index.html"), shell({ title: "Словарь терминов", description: "Русско-английский словарь терминов Java Concurrency", content: `<article>${glossary}</article>`, pageClass: "reader" }));

fs.mkdirSync(path.join(out, "assets"), { recursive: true });
for (const file of ["style.css", "app.js", "favicon.svg"]) fs.copyFileSync(path.join(root, "site", file), path.join(out, "assets", file));
fs.writeFileSync(path.join(out, "search.json"), JSON.stringify(rendered.map(({ number, title, slug, summary, plain }) => ({ number, title, slug, summary, plain }))));
fs.writeFileSync(path.join(out, ".nojekyll"), "");
console.log(`Built ${chapters.length} chapters into docs/`);
