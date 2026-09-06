/**
 * Replays an nlpgo-emitted LLM span's attribute shape through
 * parseLLMSpanMessages() so the playground-resume output can be
 * inspected without a browser session against a live trace.
 *
 * Input: the exact attribute shape nlpgo's endLLMSpan stamps —
 *   - langwatch.input  = JSON-encoded []app.ChatMessage (bare array)
 *   - langwatch.output = JSON-encoded single app.ChatMessage object
 *     ({"role":"assistant","content":"<reply>"})
 *
 * Pre-fix output: only input messages (assistant reply silently
 * dropped because the bare single-object shape fell through every
 * branch of the CH extractor).
 *
 * Post-fix output (printed below): every input turn + the assistant
 * reply at the end — exactly what the playground's chat panel needs
 * to resume the conversation.
 *
 * Run: npx tsx scripts/dogfood/prompts/llm-span-messages.ts
 */
import { parseLLMSpanMessages } from "../../../src/server/traces/parseLLMSpanMessages";

const attrs: Record<string, unknown> = {
  // nlpgo serializes the LLM request prompt as a bare array of
  // app.ChatMessage. Matches the 5-turn screenshot shape from
  // rchaves's bug report: system + 4 chat turns.
  "langwatch.input": JSON.stringify([
    { role: "system", content: "Welcome to the LangWatch Prompt Playground" },
    { role: "user", content: "how big is mars?" },
    { role: "assistant", content: "Mars is about 6,779 km..." },
    { role: "user", content: "thanks bro!" },
  ]),
  // nlpgo's endLLMSpan stamps a SINGLE app.ChatMessage struct
  // (NOT wrapped in array, NOT wrapped in {type, value}).
  // Pre-fix every CH extractor branch missed this shape.
  "langwatch.output": JSON.stringify({
    role: "assistant",
    content: "You're welcome.",
  }),
  "langwatch.span.type": "llm",
};

const messages = parseLLMSpanMessages(attrs);

console.log("=".repeat(72));
console.log("INPUT — attribute shape nlpgo's endLLMSpan stamps");
console.log("=".repeat(72));
console.log("  langwatch.input  (bare array of app.ChatMessage):");
console.log("    " + String(attrs["langwatch.input"]));
console.log("  langwatch.output (single app.ChatMessage object):");
console.log("    " + String(attrs["langwatch.output"]));
console.log();
console.log("=".repeat(72));
console.log("OUTPUT — what useLoadSpanIntoPromptPlayground feeds the chat");
console.log("=".repeat(72));
console.log(JSON.stringify(messages, null, 2));
console.log();
console.log("=".repeat(72));
console.log("VERIFICATION");
console.log("=".repeat(72));
const checks = [
  {
    name: "Conversation count: 4 input turns + 1 assistant reply = 5 total",
    pass: messages.length === 5,
    got: messages.length,
  },
  {
    name: "First message is the system turn (verbatim from input)",
    pass:
      messages[0]?.role === "system" &&
      messages[0]?.content === "Welcome to the LangWatch Prompt Playground",
    got: messages[0],
  },
  {
    name: "Last message is the assistant reply 'You're welcome.' (Bug B fix)",
    pass:
      messages[messages.length - 1]?.role === "assistant" &&
      messages[messages.length - 1]?.content === "You're welcome.",
    got: messages[messages.length - 1],
  },
  {
    name: "Penultimate message is the latest user turn 'thanks bro!'",
    pass:
      messages[messages.length - 2]?.role === "user" &&
      messages[messages.length - 2]?.content === "thanks bro!",
    got: messages[messages.length - 2],
  },
  {
    name: "Order preserved: input turns before output (chronological)",
    pass:
      messages.findIndex(
        (m) => m.role === "user" && m.content === "thanks bro!",
      ) <
      messages.findIndex(
        (m) => m.role === "assistant" && m.content === "You're welcome.",
      ),
    got: messages
      .map((m) => `${m.role}:${String(m.content ?? "").slice(0, 20)}`)
      .join(" -> "),
  },
];
for (const c of checks) {
  console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}`);
  if (!c.pass) console.log(`        got: ${JSON.stringify(c.got)}`);
}
const allPass = checks.every((c) => c.pass);
console.log();
console.log(allPass ? "ALL CHECKS PASS" : "FAILURES PRESENT");
process.exit(allPass ? 0 : 1);
