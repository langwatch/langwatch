import { createServer } from "node:http";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import dotenv from "dotenv";

dotenv.config({
  path: [".env.local", ".env"],
});


const PORT = 3456;

const server = createServer(async (req, res) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  if (req.method === "POST" && req.url === "/generate") {
    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const { messages } = JSON.parse(body);
      console.log(`[${new Date().toISOString()}] Received generate request: messages=${JSON.stringify(messages)}`);
      const { text } = await generateText({
        model: openai("gpt-5-mini"),
        messages,
      });

      console.log(`[${new Date().toISOString()}] Generation success`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text }));
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Error:`, e);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  console.log(`[${new Date().toISOString()}] 404 Not found: ${req.method} ${req.url}`);
  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => console.log(`AI server running on http://localhost:${PORT}`));
