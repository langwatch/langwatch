/**
 * The ACME shop support agent: one LLM turn with two tools.
 *
 * `answerTurn` is the shop logic. `src/server.ts` serves it over HTTP and
 * connects it to LangWatch Agent Testing.
 */
import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";

import { lookupOrder, refundOrder, REFUND_LIMIT_FREE } from "./accounts.js";

/** The account the support agent works on. Every conversation uses this one. */
export const ACCOUNT_ID = "acme-pro";

const MAX_TOOL_ROUNDS = 5;

const systemPrompt = (accountId: string) =>
  [
    "You are the support agent of ACME, an online shop.",
    `You are talking to the customer of account ${accountId}.`,
    "Call lookupOrder before you state anything about an order.",
    "Call refundOrder to refund; never promise a refund you did not get from the tool.",
    `A refund above ${REFUND_LIMIT_FREE} dollars needs the pro plan. When the tool refuses for`,
    "that reason, say in one sentence that the plan does not allow it and offer to escalate the",
    "request to a human support agent.",
    "Answer in at most three short sentences.",
  ].join(" ");

const shopTools = (accountId: string) => ({
  lookupOrder: tool({
    description: "Read one order of the current account.",
    inputSchema: z.object({ orderId: z.string().describe("For example A-1001") }),
    execute: async ({ orderId }) => lookupOrder({ accountId, orderId }),
  }),
  refundOrder: tool({
    description: "Refund an amount on one order of the current account.",
    inputSchema: z.object({
      orderId: z.string(),
      amount: z.number().describe("In dollars"),
    }),
    execute: async ({ orderId, amount }) => refundOrder({ accountId, orderId, amount }),
  }),
});

/** One support turn: the model answers, and calls the two tools as it needs them. */
export async function answerTurn({
  messages,
  accountId,
  model = "gpt-5-mini",
}: {
  messages: ModelMessage[];
  accountId: string;
  model?: string;
}): Promise<string> {
  const { text } = await generateText({
    model: openai(model),
    system: systemPrompt(accountId),
    messages,
    tools: shopTools(accountId),
    stopWhen: stepCountIs(MAX_TOOL_ROUNDS),
  });
  return text;
}
