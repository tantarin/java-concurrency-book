import fs from "node:fs";
import path from "node:path";

const dist = path.resolve("docs");
if (!fs.existsSync(dist)) throw new Error("Run npm run build first");
const htmlFiles = [];
function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); entry.isDirectory() ? walk(file) : entry.name.endsWith(".html") && htmlFiles.push(file); } }
walk(dist);
const broken = [];
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (!href.startsWith("/java-concurrency-book/") || href.includes("#")) continue;
    const relative = href.slice("/java-concurrency-book/".length);
    const target = path.join(dist, relative, relative.endsWith("/") || !path.extname(relative) ? "index.html" : "");
    if (!fs.existsSync(target)) broken.push(`${path.relative(dist, file)} -> ${href}`);
  }
}
if (broken.length) throw new Error(`Broken internal links:\n${broken.join("\n")}`);
console.log(`Checked ${htmlFiles.length} pages: all internal links resolve.`);
