import "./build.mjs";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";

const { default: worker } = await import("../dist/server/index.js");

const sqlite = new DatabaseSync(":memory:");
const migrations = new URL("../migrations/", import.meta.url);
for (const file of readdirSync(migrations).sort()) sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
const env = {
  ...process.env,
  PREVIEW_DEMO_ADMIN: "1",
  DB: {
    prepare(sql) {
      const bind = (...values) => {
        const prepared = sqlite.prepare(sql);
        return {
          first: async () => prepared.get(...values) ?? null,
          all: async () => ({ results: prepared.all(...values) }),
          execute: () => ({ meta: { changes: prepared.run(...values).changes } }),
          run: async () => ({ meta: { changes: prepared.run(...values).changes } }),
        };
      };
      return { bind, all: () => bind().all() };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  },
};
const server = createServer(async (req, res) => {
  const host = req.headers.host;
  const proxyProtocol = req.headers["x-forwarded-proto"];
  const protocol = proxyProtocol === "https" || req.headers.origin === `https://${host}` ? "https" : "http";
  const init = { method: req.method, headers: req.headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  const response = await worker.fetch(new Request(new URL(req.url, `${protocol}://${host}`), init), env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body).pipe(res);
  else res.end();
});
const portArg = process.argv.indexOf("--port");
const port = Number(portArg >= 0 ? process.argv[portArg + 1] : process.env.PORT || "4173");
server.listen(port, "0.0.0.0", () => console.log(`touchCD listening on http://localhost:${port}`));
