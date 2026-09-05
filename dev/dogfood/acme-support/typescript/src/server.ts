/**
 * The ACME support application: one HTTP endpoint over the support agent.
 *
 * Run it with `pnpm dev`. The same process serves `POST /chat` and answers
 * simulations from LangWatch, because `connectAgent` opens one outbound
 * connection when the module loads.
 */
import "dotenv/config";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { connectAgent, type AgentMessage } from "langwatch/agent";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import { ACCOUNT_ID, answerTurn } from "./agent.js";
import type { ModelMessage } from "ai";

export const acmeSupport = connectAgent(
  {
    name: "acme-support",
    // The zod schema types `params`, and the SDK validates what a run sends.
    // `z.enum` becomes a closed option list in the run dialog.
    parameters: z.object({
      model: z
        .enum(["gpt-5-mini", "gpt-5"])
        .default("gpt-5-mini")
        .describe("The model that answers"),
    }),
  },
  async ({ messages, params, session }) => {
    const turn = ((session as { turn?: number } | null)?.turn ?? 0) + 1;
    const output = await answerTurn({
      messages: messages as ModelMessage[],
      accountId: ACCOUNT_ID,
      model: params.model,
    });
    return { output, session: { turn } };
  },
);

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", accountId: ACCOUNT_ID }));

app.post("/chat", async (c) => {
  const body = await c.req.json<{ messages: AgentMessage[]; threadId?: string }>();
  const reply = await acmeSupport({
    messages: body.messages,
    threadId: body.threadId ?? "local",
  });
  return c.json({ output: String(reply.output), accountId: ACCOUNT_ID });
});

export { app };

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const port = Number(process.env.PORT ?? 8766);
  serve({ fetch: app.fetch, port }, ({ port: bound }) => {
    console.log(`ACME support listening on http://localhost:${bound}`);
  });
}
