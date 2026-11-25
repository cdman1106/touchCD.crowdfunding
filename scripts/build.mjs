import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const paths = {
  "/": "index.html",
  "/manage": "manage.html",
  "/site.css": "site.css",
  "/app.js": "app.js",
  "/consultation": "consultation.html",
  "/consultation.css": "consultation.css",
  "/consultation.js": "consultation.js",
  "/mockup.js": "mockup.js",
  "/consultation-attachments.js": "consultation-attachments.js",
  "/touchcd-studio-front.webp": "touchcd-studio-front.webp",
  "/touchcd-studio-removed.webp": "touchcd-studio-removed.webp",
  "/touchcd-music-site-example.webp": "touchcd-music-site-example.webp",
  "/touchcd-studio-back.webp": "touchcd-studio-back.webp",
  "/touchcd-studio-open.webp": "touchcd-studio-open.webp",
  "/touchcd-studio-both.webp": "touchcd-studio-both.webp",
  "/touchcd-jazz-front.webp": "touchcd-jazz-front.webp",
  "/touchcd-jazz-back.webp": "touchcd-jazz-back.webp",
  "/touchcd-jazz-open.webp": "touchcd-jazz-open.webp",
  "/touchcd-jazz-both.webp": "touchcd-jazz-both.webp",
  "/touchcd-reference-open.webp": "touchcd-reference-open.webp",
  "/touchcd-reference-front.webp": "touchcd-reference-front.webp",
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
// These schema-only migrations can also initialize new databases at runtime.
const releaseMigration = "0005_release_details.sql";
const initialMigrations = [
  "0001_reservations.sql",
  "0002_project_catalog.sql",
  "0003_email_and_pickup.sql",
  "0004_payment_settings.sql",
  releaseMigration,
];
const migrationSql = await Promise.all(initialMigrations.map((name) =>
  readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8")));
const releaseColumns = migrationSql.at(-1).split(";").map((statement) => statement.trim()).filter(Boolean).map((sql) => {
  const match = sql.match(/^ALTER TABLE (projects|reservations) ADD COLUMN ([a-z_]+) /);
  if (!match) throw new Error("Release details migration must contain only ADD COLUMN statements.");
  return { table: match[1], column: match[2], sql };
});
const database = new DatabaseSync(":memory:");
for (const sql of migrationSql) database.exec(sql);
const initialSchema = database.prepare(`SELECT sql FROM sqlite_schema
  WHERE type IN ('table', 'index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid`).all()
  .map(({ sql }) => sql.replace(/^CREATE (TABLE|INDEX) /i, "CREATE $1 IF NOT EXISTS "));
database.close();
await mkdir(output, { recursive: true });
await writeFile(new URL("index.js", output), `const siteAssets = ${JSON.stringify(Object.fromEntries(files))};\nconst initialSchema = ${JSON.stringify(initialSchema)};\nconst initialMigrations = ${JSON.stringify(initialMigrations)};\nconst releaseMigration = ${JSON.stringify(releaseMigration)};\nconst releaseColumns = ${JSON.stringify(releaseColumns)};\n${worker}`);
