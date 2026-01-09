import { createServer } from "node:http";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const PORT = 3456;

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/generate") {
    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const { prompt, model = "gpt-4o-mini" } = JSON.parse(body);
      const { text } = await generateText({
        model: openai(model),
        prompt,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => console.log(`AI server running on http://localhost:${PORT}`));
