import { request } from "playwright";
import fs from "node:fs";
const sqls = JSON.parse(fs.readFileSync("/tmp/proof-8296/sqls.json", "utf8"));
const ctx = await request.newContext({ storageState: "/tmp/proof-8296/auth.json", baseURL: "http://localhost:5570" });
const projectId = process.env.PROJECT_ID;
const end = Date.now(), start = end - 30 * 864e5;
for (const { id, sql } of sqls) {
  const r = await ctx.post("/api/trpc/analytics.lwql.query", { data: { json: { projectId, sql, parameters: {}, timeWindow: { start, end } } } });
  const body = await r.text();
  const m = body.match(/"rows":\[(.*?)\],"statistics"/s);
  const rows = m ? (m[1] ? m[1].split("},{").length : 0) : "?";
  console.log(id, r.status(), r.ok() ? `rows=${rows}` : body.slice(0, 300));
}
await ctx.dispose();
