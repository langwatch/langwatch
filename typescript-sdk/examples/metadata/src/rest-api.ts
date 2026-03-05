/**
 * Metadata and Labels — REST API Example (No SDK)
 *
 * Demonstrates sending metadata directly via the LangWatch REST API
 * without using the LangWatch TypeScript SDK.
 *
 * This is useful when:
 * - You want full control over trace construction
 * - You're integrating from a non-Node environment (edge, Deno, etc.)
 * - You're debugging or prototyping
 *
 * Run: pnpm run start:rest-api
 */

const LANGWATCH_API_KEY = process.env.LANGWATCH_API_KEY!;
const LANGWATCH_ENDPOINT =
  process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

interface TraceMetadata {
  user_id: string;
  thread_id: string;
  customer_id: string;
  labels: string[];
  [key: string]: unknown;
}

async function sendTraceWithMetadata(opts: {
  userMessage: string;
  assistantResponse: string;
  metadata: TraceMetadata;
}): Promise<void> {
  const nowMs = Date.now();
  const traceId = `trace-${crypto.randomUUID().slice(0, 12)}`;
  const spanId = `span-${crypto.randomUUID().slice(0, 12)}`;

  const payload = {
    trace_id: traceId,
    spans: [
      {
        type: "llm",
        span_id: spanId,
        name: "chat-completion",
        model: "gpt-4o-mini",
        input: {
          type: "chat_messages",
          value: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: opts.userMessage },
          ],
        },
        output: {
          type: "chat_messages",
          value: [{ role: "assistant", content: opts.assistantResponse }],
        },
        timestamps: {
          started_at: nowMs - 500,
          finished_at: nowMs,
        },
      },
    ],
    metadata: opts.metadata,
  };

  const response = await fetch(`${LANGWATCH_ENDPOINT}/api/collector`, {
    method: "POST",
    headers: {
      "X-Auth-Token": LANGWATCH_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  console.log(`  POST /api/collector -> ${response.status}`);
}

async function main() {
  console.log("LangWatch Metadata Example — REST API (TypeScript)\n");
  console.log("Sends traces directly via HTTP without the LangWatch SDK.\n");
  console.log("=".repeat(50) + "\n");

  const userId = "user-12345";
  const customerId = "acme-corp";
  const threadId = `conv-${Date.now()}`;

  const sharedMetadata: TraceMetadata = {
    // Reserved fields
    user_id: userId,
    thread_id: threadId,
    customer_id: customerId,
    labels: ["development", "tier-pro", "rest-api-example"],
    // Custom metadata — any other keys
    request_source: "cli-example",
    sdk_version: "none (raw REST)",
  };

  // First message
  console.log("Sending trace 1: 'What is the capital of France?'");
  await sendTraceWithMetadata({
    userMessage: "What is the capital of France?",
    assistantResponse: "The capital of France is Paris.",
    metadata: sharedMetadata,
  });

  // Second message in same thread
  console.log("Sending trace 2: 'What about Germany?'");
  await sendTraceWithMetadata({
    userMessage: "What about Germany?",
    assistantResponse: "The capital of Germany is Berlin.",
    metadata: sharedMetadata, // Same thread_id groups them together
  });

  console.log("\n" + "=".repeat(50));
  console.log("\nCheck your LangWatch dashboard to see:");
  console.log("  - Both messages grouped under the same thread");
  console.log("  - User and customer IDs for filtering");
  console.log("  - Labels for categorization");
  console.log("  - Custom metadata in the trace details\n");
}

main().catch(console.error);
