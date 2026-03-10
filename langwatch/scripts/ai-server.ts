import { createServer } from "node:http";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { context as otelContext, propagation, trace } from "@opentelemetry/api";

// getLangWatchTracer is loaded lazily after setupObservability initializes
let tracer:
  | ReturnType<typeof import("langwatch").getLangWatchTracer>
  | undefined;

// Initialize LangWatch observability before the server starts handling requests.
// This sets up the OTEL NodeSDK with LangWatch exporters so that Vercel AI SDK
// spans (LLM calls, tool calls) are captured and exported.
async function initObservability() {
  const apiKey = process.env.LANGWATCH_API_KEY;
  const endpoint = process.env.LANGWATCH_ENDPOINT;

  console.log(
    `[ai-server] LANGWATCH_API_KEY: ${apiKey ? `${apiKey.slice(0, 8)}...` : "NOT SET"}`,
  );
  console.log(`[ai-server] LANGWATCH_ENDPOINT: ${endpoint ?? "NOT SET"}`);

  if (apiKey) {
    const { setupObservability } = await import("langwatch/observability/node");
    setupObservability({
      serviceName: "ai-server",
      debug: {
        consoleTracing: true,
        logLevel: "debug",
      },
    });
    const { getLangWatchTracer } = await import("langwatch");
    tracer = getLangWatchTracer("ai-server");
    console.log("[ai-server] LangWatch observability initialized (debug mode)");
  } else {
    console.warn(
      "[ai-server] WARNING: No LANGWATCH_API_KEY — traces will NOT be exported",
    );
  }
}
void initObservability();

/**
 * Test AI Server — Weather Agent
 *
 * A minimal HTTP server that simulates a weather agent with tool calls.
 * Used for testing HTTP agent configurations and verifying that tool call
 * spans appear correctly in OTEL traces.
 *
 * The agent has a `get_weather` tool that returns mock weather data.
 * When asked about weather, the LLM will make a tool call, which produces
 * tool call spans in the trace for verification.
 *
 * Required headers:
 *   X-API-Key: <your-openai-api-key>
 *   X-Client-ID: <client-identifier>
 *
 * Request body:
 *   {
 *     "model": "gpt-4o-mini",  // required
 *     "messages": [...]        // required
 *   }
 *
 * Usage:
 *   pnpm tsx scripts/ai-server.ts
 *   curl -X POST http://localhost:3456/generate \
 *     -H "Content-Type: application/json" \
 *     -H "X-API-Key: sk-..." \
 *     -H "X-Client-ID: my-app" \
 *     -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "What is the weather in Tokyo?"}]}'
 */

const MOCK_WEATHER: Record<string, { temperature: number; condition: string }> =
  {
    tokyo: { temperature: 22, condition: "partly cloudy" },
    london: { temperature: 14, condition: "rainy" },
    "new york": { temperature: 28, condition: "sunny" },
    paris: { temperature: 18, condition: "overcast" },
    sydney: { temperature: 25, condition: "clear" },
  };

const weatherTool = tool({
  description: "Get the current weather for a city",
  inputSchema: z.object({
    city: z.string().describe("The city name to get weather for"),
  }),
  outputSchema: z.object({
    city: z.string(),
    temperature_celsius: z.number(),
    condition: z.string(),
  }),
  execute: async ({ city }) => {
    const key = city.toLowerCase();
    const data = MOCK_WEATHER[key] ?? { temperature: 20, condition: "unknown" };
    return {
      city,
      temperature_celsius: data.temperature,
      condition: data.condition,
    };
  },
});

const SYSTEM_PROMPT =
  "You are a helpful weather assistant. Use the get_weather tool to look up weather information when asked. Always use the tool rather than guessing.";

const PORT = 3456;
const API_KEY_HEADER = "x-api-key";
const CLIENT_ID_HEADER = "x-client-id";

type RequestBody = {
  model?: string;
  messages?: Array<{ role: string; content: string }>;
};

function jsonResponse(
  res: import("node:http").ServerResponse,
  status: number,
  data: unknown,
) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);

  // Log trace context headers when present (for OTEL propagation debugging)
  const traceparent = req.headers["traceparent"];
  if (traceparent) {
    console.log(
      `[${timestamp}] Trace context: traceparent=${traceparent}`,
    );
  }

  // CORS headers for browser testing
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-API-Key, X-Client-ID",
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/generate") {
    // Validate API key header
    const apiKey = req.headers[API_KEY_HEADER];
    if (!apiKey || typeof apiKey !== "string") {
      console.log(`[${timestamp}] 401 Missing X-API-Key header`);
      jsonResponse(res, 401, {
        error: "Unauthorized",
        message: "Missing required header: X-API-Key",
      });
      return;
    }

    // Validate Client ID header
    const clientId = req.headers[CLIENT_ID_HEADER];
    if (!clientId || typeof clientId !== "string") {
      console.log(`[${timestamp}] 400 Missing X-Client-ID header`);
      jsonResponse(res, 400, {
        error: "Bad Request",
        message: "Missing required header: X-Client-ID",
      });
      return;
    }

    // Parse body
    let body = "";
    for await (const chunk of req) body += chunk;

    let parsed: RequestBody;
    try {
      parsed = JSON.parse(body) as RequestBody;
    } catch {
      console.log(`[${timestamp}] 400 Invalid JSON body`);
      jsonResponse(res, 400, {
        error: "Bad Request",
        message: "Invalid JSON in request body",
      });
      return;
    }

    // Validate required fields
    const { model, messages } = parsed;

    if (!model || typeof model !== "string") {
      console.log(`[${timestamp}] 400 Missing model field`);
      jsonResponse(res, 400, {
        error: "Bad Request",
        message: "Missing required field: model",
      });
      return;
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.log(`[${timestamp}] 400 Missing messages field`);
      jsonResponse(res, 400, {
        error: "Bad Request",
        message: "Missing required field: messages (must be non-empty array)",
      });
      return;
    }

    console.log(
      `[${timestamp}] Generating: client=${clientId}, model=${model}, messages=${messages.length}`,
    );

    try {
      // Extract incoming trace context so AI SDK spans are children of the caller's trace
      const parentContext = propagation.extract(
        otelContext.active(),
        req.headers,
      );
      const extractedSpan = trace.getSpan(parentContext);
      const extractedTraceId = extractedSpan?.spanContext().traceId;
      const extractedSpanId = extractedSpan?.spanContext().spanId;
      console.log(
        `[${timestamp}] OTEL context extraction: traceparent=${traceparent ?? "none"}, ` +
          `extractedTraceId=${extractedTraceId ?? "none"}, extractedSpanId=${extractedSpanId ?? "none"}`,
      );

      // Create OpenAI client with the provided API key
      const openai = createOpenAI({ apiKey });

      // Run generateText within the extracted trace context, wrapped in a
      // labeled span so the trace is visible in LangWatch with proper labels.
      const generate = async () => {
        if (tracer) {
          return tracer.withActiveSpan("weather-agent", async (span) => {
            span.setAttribute(
              "metadata",
              JSON.stringify({ labels: ["ai-server", "weather-agent"] }),
            );
            span.setAttribute("langwatch.user.id", clientId);
            return generateText({
              model: openai(model),
              system: SYSTEM_PROMPT,
              messages: messages as NonNullable<
                Parameters<typeof generateText>[0]["messages"]
              >,
              tools: { get_weather: weatherTool },
              stopWhen: stepCountIs(3),
              experimental_telemetry: { isEnabled: true },
            });
          });
        }
        return generateText({
          model: openai(model),
          system: SYSTEM_PROMPT,
          messages: messages as NonNullable<
            Parameters<typeof generateText>[0]["messages"]
          >,
          tools: { get_weather: weatherTool },
          stopWhen: stepCountIs(3),
          experimental_telemetry: { isEnabled: true },
        });
      };

      const { text, steps } = await otelContext.with(parentContext, generate);

      const toolCalls = steps.flatMap((s) => s.toolCalls);
      console.log(
        `[${timestamp}] 200 Generation success (${steps.length} steps, ${toolCalls.length} tool calls)`,
      );
      if (toolCalls.length > 0) {
        for (const tc of toolCalls) {
          console.log(
            `[${timestamp}]   tool_call: ${tc.toolName}(${JSON.stringify(tc.input)})`,
          );
        }
      }
      // Log active span after generation to verify OTEL context
      const activeSpan = trace.getActiveSpan();
      console.log(
        `[${timestamp}] Active span after generation: ${activeSpan ? `traceId=${activeSpan.spanContext().traceId}` : "none"}`,
      );
      jsonResponse(res, 200, {
        choices: [
          {
            message: {
              role: "assistant",
              content: text,
            },
          },
        ],
        model,
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error(`[${timestamp}] 500 Generation error:`, errorMessage);

      // Check for common OpenAI errors
      if (
        errorMessage.includes("401") ||
        errorMessage.includes("invalid_api_key")
      ) {
        jsonResponse(res, 401, {
          error: "Unauthorized",
          message: "Invalid OpenAI API key",
        });
        return;
      }

      if (errorMessage.includes("model")) {
        jsonResponse(res, 400, {
          error: "Bad Request",
          message: `Invalid model: ${model}`,
        });
        return;
      }

      jsonResponse(res, 500, {
        error: "Internal Server Error",
        message: errorMessage,
      });
    }
    return;
  }

  console.log(`[${timestamp}] 404 Not found: ${req.method} ${req.url}`);
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({ error: "Not Found", message: `${req.method} ${req.url}` }),
  );
});

server.listen(PORT, () => {
  console.log(`
AI Test Server running on http://localhost:${PORT}/generate

  Method:  POST
  Headers: X-API-Key: <openai-api-key>
           X-Client-ID: <client-identifier>
           Content-Type: application/json
  Body:    { "model": "gpt-4o-mini", "messages": [...] }

  Docker:  http://host.docker.internal:${PORT}/generate
  Tunnel:  docker run --rm cloudflare/cloudflared tunnel \\
           --url http://host.docker.internal:${PORT}
`);
});
