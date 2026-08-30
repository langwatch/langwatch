/**
 * A support agent connected to LangWatch simulations.
 *
 * Run it with `npx tsx support-agent.ts`. The wrapper opens one outbound
 * connection to LangWatch, the agent shows as Online in Agent Testing, and
 * every simulation turn reaches `supportAgent` below. Ctrl-C deregisters it.
 *
 * Environment: LANGWATCH_API_KEY (required), OPENAI_API_KEY (required),
 * LANGWATCH_ENDPOINT (self-hosted), APP_ENV or LANGWATCH_AGENT_ENVIRONMENT
 * (default development, a personal agent scoped to your key).
 */
import { openai } from "@ai-sdk/openai";
import { generateText, type ModelMessage } from "ai";
import { connectAgent } from "langwatch/agent";
import { z } from "zod";

const SYSTEM_PROMPT = (plan: string) =>
  `You are the support agent of ACME, a project management tool. The customer is on the ${plan} plan. Answer in two short sentences. If the customer wants a refund, ask for the invoice number first.`;

export const supportAgent = connectAgent(
  {
    name: "support-agent",
    description: "Answers ACME support questions",
    // The zod schema types `params` below, and the SDK validates the values a
    // run supplies against it. `z.enum` becomes a closed option list in the run
    // dialog, `.default()` the default, `.describe()` the description.
    parameters: z.object({
      model: z
        .enum(["gpt-5-mini", "gpt-5"])
        .default("gpt-5-mini")
        .describe("The model that answers"),
      plan: z
        .string()
        .default("free")
        .describe("The customer plan the agent believes it is talking to"),
    }),
  },
  async ({ messages, params, session }) => {
    // `session` is whatever this function returned as session on the previous
    // turn of the same conversation, null on the first one. Here it counts
    // the turns, but it can be any JSON value: an id, a token, a cursor.
    const turn = ((session as { turn?: number } | null)?.turn ?? 0) + 1;

    const { text } = await generateText({
      model: openai(params.model),
      system: SYSTEM_PROMPT(params.plan),
      messages: messages as ModelMessage[],
    });

    return { output: text, session: { turn } };
  },
);

// The wrapped function is directly callable, so a plain run answers one
// question locally while the connection stays open for simulations.
if (process.argv[2]) {
  const reply = await supportAgent({ messages: [{ role: "user", content: process.argv.slice(2).join(" ") }] });
  console.log(reply.output);
}
