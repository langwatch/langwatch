/**
 * Guardrail Example - Real-time Evaluation for Safety
 *
 * This example demonstrates how to use langwatch.evaluations.evaluate()
 * to run guardrails in real-time, blocking or modifying responses
 * based on evaluation results.
 *
 * The guardrail runs within a traced span, so it appears connected
 * to the parent trace in the LangWatch dashboard.
 *
 * Run with: npm run start:guardrail
 */

import "dotenv/config";
import { LangWatch, getLangWatchTracer } from "langwatch";
import { setupObservability } from "langwatch/observability/node";

// Check for required environment variables
if (!process.env.LANGWATCH_API_KEY) {
  console.error("❌ LANGWATCH_API_KEY is required. Create a .env file with your API key.");
  console.error("   Get your API key from https://app.langwatch.ai");
  process.exit(1);
}

// Set up LangWatch observability for tracing
setupObservability();

// Get a tracer for creating spans
const tracer = getLangWatchTracer("guardrail-example");

// Initialize LangWatch client for evaluations
const langwatch = new LangWatch();

// Simulated user inputs (some may contain PII)
const userInputs = [
  "Can you help me summarize this article?",
  "My email is john.doe@example.com and my phone is 555-1234",
  "Tell me about machine learning",
  "My social security number is 123-45-6789",
];

// Simulated LLM response generator
const generateResponse = async (input: string): Promise<string> => {
  // Use tracer.startActiveSpan to create a child span for the LLM call
  return tracer.startActiveSpan("generateResponse", async (span) => {
    try {
      span.setAttribute("langwatch.span.type", "llm");
      span.setAttribute("gen_ai.request.model", "mock-llm");

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Simple echo-based response for demo
      let response: string;
      if (input.includes("email") || input.includes("social security")) {
        response = `I received your personal information: ${input}`;
      } else {
        response = `Here's a helpful response about: ${input.split(" ").slice(0, 5).join(" ")}...`;
      }

      span.setAttribute("gen_ai.response.model", "mock-llm");
      return response;
    } finally {
      span.end();
    }
  });
};

// Process a single user message with guardrail
const processMessage = async (userInput: string): Promise<string> => {
  console.log(`\n📝 User Input: "${userInput}"`);

  // Generate the response (this creates a child span)
  const generatedResponse = await generateResponse(userInput);
  console.log(`🤖 Generated Response: "${generatedResponse}"`);

  // Run guardrail to check for PII - this creates a span attached to the current trace
  try {
    const guardrail = await langwatch.evaluations.evaluate(
      "presidio/pii_detection",
      {
        data: {
          input: userInput,
          output: generatedResponse,
        },
        name: "PII Detection Guardrail",
        asGuardrail: true,
      }
    );

    console.log(`🔍 Guardrail Result:`);
    console.log(`   - Status: ${guardrail.status}`);
    console.log(`   - Passed: ${guardrail.passed}`);
    if (guardrail.score !== undefined) {
      console.log(`   - Score: ${guardrail.score}`);
    }

    if (guardrail.passed === false) {
      console.log("⛔ BLOCKED: PII detected in the message");
      if (guardrail.details) {
        console.log(`   - Details: ${guardrail.details}`);
      }
      return "I'm sorry, I can't process messages containing personal information.";
    } else {
      console.log("✅ PASSED: No PII detected, response is safe to send");
      return generatedResponse;
    }
  } catch (error) {
    console.error(`❌ Guardrail error: ${error}`);
    // On guardrail error, you might want to block or allow based on your policy
    console.log("⚠️  Allowing response due to guardrail error (fail-open policy)");
    return generatedResponse;
  }
};

const main = async () => {
  console.log("🛡️  Guardrail Example - Real-time Evaluation with Tracing\n");

  for (const userInput of userInputs) {
    // Create a parent span for the entire message processing
    await tracer.startActiveSpan(
      "chat",
      {
        attributes: {
          "langwatch.span.type": "chain",
          "user.input": userInput,
        },
      },
      async (span) => {
        try {
          const response = await processMessage(userInput);
          span.setAttribute("assistant.response", response);
        } finally {
          span.end();
        }
      }
    );
  }

  console.log("\n✅ Guardrail demo complete!");
  console.log("Check the LangWatch dashboard to see the traces with nested guardrail spans.");

  // Give time for spans to flush
  await new Promise((resolve) => setTimeout(resolve, 2000));
};

main().catch(console.error);
