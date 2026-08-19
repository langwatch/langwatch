/**
 * Metadata and Labels Example
 *
 * Demonstrates ALL metadata fields supported by LangWatch:
 * - gen_ai.conversation.id (OTEL semconv, primary)
 * - langwatch.thread.id (legacy alias)
 * - langwatch.user.id
 * - langwatch.customer.id
 * - langwatch.labels (JSON array)
 * - metadata attribute (custom JSON object)
 *
 * Run: pnpm start
 */

import { getLangWatchTracer } from "langwatch";
import { openai } from "@ai-sdk/openai";
import { generateText, registerTelemetry } from "ai";
import { OpenTelemetry } from "@ai-sdk/otel";
import { setupObservability } from "langwatch/observability/node";

setupObservability();

// AI SDK 7 emits no OpenTelemetry spans until an integration is registered.
// Without this, LangWatch receives nothing from generateText/streamText.
registerTelemetry(new OpenTelemetry());

const tracer = getLangWatchTracer("metadata-example");

interface UserContext {
  userId: string;
  customerId: string;
  conversationId: string;
  userTier: "free" | "pro" | "enterprise";
  environment: string;
}

async function handleUserMessage(
  message: string,
  context: UserContext
): Promise<string> {
  return await tracer.withActiveSpan(
    "HandleUserMessage",
    {
      attributes: {
        // =========================================
        // Thread/Conversation ID
        // =========================================
        // Primary: OpenTelemetry GenAI semantic convention
        "gen_ai.conversation.id": context.conversationId,

        // Legacy: Also supported for backwards compatibility
        "langwatch.thread.id": context.conversationId,

        // =========================================
        // User & Customer Identification
        // =========================================
        // Identifies the end user making the request
        "langwatch.user.id": context.userId,

        // Identifies the customer/tenant (for multi-tenant apps)
        "langwatch.customer.id": context.customerId,

        // =========================================
        // Labels (for filtering and categorization)
        // =========================================
        // Must be a JSON-stringified array of strings
        "langwatch.labels": JSON.stringify([
          context.environment,
          `tier-${context.userTier}`,
          "vercel-ai",
        ]),

        // =========================================
        // Custom Metadata (any additional context)
        // =========================================
        // Must be a JSON-stringified object
        metadata: JSON.stringify({
          feature_flags: ["new-model-v2", "streaming-enabled"],
          request_source: "cli-example",
          user_tier: context.userTier,
          sdk_version: "1.0.0",
        }),
      },
    },
    async (span) => {
      console.log("📊 Sending request with metadata:");
      console.log(`   User: ${context.userId}`);
      console.log(`   Customer: ${context.customerId}`);
      console.log(`   Conversation: ${context.conversationId}`);
      console.log(`   Labels: ${context.environment}, tier-${context.userTier}`);
      console.log("");

      const result = await generateText({
        model: openai("gpt-5-mini"),
        instructions: "You are a helpful assistant. Be concise.",
        messages: [{ role: "user", content: message }],
      });

      span.setAttribute("output.tokens", result.usage?.outputTokens ?? 0);
      span.setAttribute("input.tokens", result.usage?.promptTokens ?? 0);

      return result.text;
    }
  );
}

async function main() {
  console.log("🏷️  LangWatch Metadata Example\n");
  console.log("This example demonstrates all metadata fields:");
  console.log("  • gen_ai.conversation.id - Thread/conversation grouping");
  console.log("  • langwatch.user.id - User identification");
  console.log("  • langwatch.customer.id - Customer/tenant identification");
  console.log("  • langwatch.labels - Categorization tags");
  console.log("  • metadata - Custom key-value data\n");
  console.log("=".repeat(50) + "\n");

  // Simulate a user context (in real apps, this comes from auth/session)
  const userContext: UserContext = {
    userId: "user-12345",
    customerId: "acme-corp",
    conversationId: `conv-${Date.now()}`,
    userTier: "pro",
    environment: "development",
  };

  try {
    // First message in conversation
    console.log("User: What is the capital of France?\n");
    const response1 = await handleUserMessage(
      "What is the capital of France?",
      userContext
    );
    console.log(`Assistant: ${response1}\n`);

    // Second message in same conversation (same conversation ID)
    console.log("User: What about Germany?\n");
    const response2 = await handleUserMessage(
      "What about Germany?",
      userContext
    );
    console.log(`Assistant: ${response2}\n`);

    console.log("=".repeat(50));
    console.log("\n✅ Check your LangWatch dashboard to see:");
    console.log("   • Both messages grouped under the same conversation");
    console.log("   • User and customer IDs for filtering");
    console.log("   • Labels for categorization");
    console.log("   • Custom metadata in the trace details\n");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main().catch(console.error);
