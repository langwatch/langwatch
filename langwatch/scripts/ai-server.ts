import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

/**
 * Test AI Server
 *
 * A minimal HTTP server for testing HTTP agent configurations.
 * Simulates a real AI endpoint with proper auth requirements.
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
 *     -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "Hello"}]}'
 */

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
      // Create OpenAI client with the provided API key
      const openai = createOpenAI({ apiKey });

      const { text } = await generateText({
        model: openai(model),
        messages: messages as NonNullable<
          Parameters<typeof generateText>[0]["messages"]
        >,
      });

      console.log(`[${timestamp}] 200 Generation success`);
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

function startCloudflaredTunnel(): void {
  const cloudflared = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${PORT}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  cloudflared.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("║  Tunnel: cloudflared not installed                       ║");
      console.log("║          brew install cloudflared (or see docs)          ║");
    } else {
      console.log(`║  Tunnel: Error starting cloudflared: ${err.message.slice(0, 20)}  ║`);
    }
    printFooter();
  });

  // cloudflared outputs the URL to stderr
  cloudflared.stderr.on("data", (data: Buffer) => {
    const output = data.toString();
    const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (urlMatch) {
      const tunnelUrl = urlMatch[0];
      const paddedUrl = `${tunnelUrl}/generate`.padEnd(43);
      console.log(`║  Tunnel: ${paddedUrl}║`);
      printFooter();
    }
  });

  cloudflared.on("close", (code) => {
    if (code !== 0 && code !== null) {
      console.log(`\n[cloudflared exited with code ${code}]`);
    }
  });

  // Cleanup on exit
  process.on("SIGINT", () => {
    cloudflared.kill();
    process.exit();
  });
  process.on("SIGTERM", () => {
    cloudflared.kill();
    process.exit();
  });
}

function printFooter(): void {
  console.log(`╠════════════════════════════════════════════════════════════╣
║  Body:    { "model": "gpt-4o-mini", "messages": [...] }    ║
╚════════════════════════════════════════════════════════════╝
`);
}

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    AI Test Server                          ║
╠════════════════════════════════════════════════════════════╣
║  URL:     http://localhost:${PORT}/generate                   ║
║  Docker:  http://host.docker.internal:${PORT}/generate        ║
║  Method:  POST                                             ║
║  Headers: X-API-Key: <openai-api-key>                      ║
║           X-Client-ID: <client-identifier>                 ║
║           Content-Type: application/json                   ║`);

  // Start cloudflared tunnel (will print tunnel URL or error, then footer)
  startCloudflaredTunnel();
});
