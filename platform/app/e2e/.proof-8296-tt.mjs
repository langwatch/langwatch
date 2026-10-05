import { request } from "playwright";
import fs from "node:fs";
const sql = JSON.parse(fs.readFileSync("/tmp/proof-8296/sqls.json","utf8")).find(x=>x.id==="top-topics").sql;
const ctx = await request.newContext({ storageState: "/tmp/proof-8296/auth.json", baseURL: "http://localhost:5570" });
const end = Date.now(), start = end - 30*864e5;
const r = await ctx.post("/api/trpc/analytics.lwql.query", { data: { json: { projectId: "local-dev-project", sql, parameters: {}, timeWindow: { start, end } } } });
console.log(r.status(), (await r.text()).match(/"rows":\[.*?\]/s)?.[0]);
