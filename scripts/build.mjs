import { mkdir, readFile, writeFile } from "node:fs/promises";

const paths = {
  "/": "index.html",
  "/manage": "manage.html",
  "/site.css": "site.css",
  "/app.js": "app.js",
  "/manage.js": "manage.js",
  "/cd-keychain.webp": "cd-keychain.webp",
  "/low-frequency.webp": "low-frequency.webp",
  booking: "booking.html",
};
const files = await Promise.all(Object.entries(paths).map(async ([route, name]) => {
  const bytes = await readFile(new URL(`../public/${name}`, import.meta.url));
  return [route, name.endsWith(".webp") ? {base64: bytes.toString("base64")} : bytes.toString("utf8")];
}));
const output = new URL("../dist/server/", import.meta.url);
const modules = await Promise.all(["catalog", "pages", "mail", "payment-settings", "worker"].map((name) =>
  readFile(new URL(`../src/${name}.js`, import.meta.url), "utf8")));
const worker = modules.join("\n");
await mkdir(output, { recursive: true });
await writeFile(new URL("index.js", output), `const siteAssets = ${JSON.stringify(Object.fromEntries(files))};\n${worker}`);
