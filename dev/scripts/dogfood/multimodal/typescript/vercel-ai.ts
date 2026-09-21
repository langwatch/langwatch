/**
 * Vercel AI SDK, traced through LangWatch's OpenTelemetry exporter.
 *
 *   node vercel-ai.ts image
 *   node vercel-ai.ts pdf
 *
 * An image and a PDF both go in an AI SDK `file` part inside one user
 * message. `experimental_telemetry` turns on tracing for this call, and
 * `setupObservability()` points the OpenTelemetry exporter at LangWatch.
 * Model traffic goes through the OpenAI-shaped chat completions path so the
 * LangWatch AI Gateway, reached through OPENAI_BASE_URL, can serve it.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { setupObservability } from "langwatch/observability/node";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, "..", "assets");

const MODEL = "gpt-5-mini";

type Modality = "image" | "pdf";

interface Attachment {
  path: string;
  mediaType: string;
}

function modality(): Modality {
  const value = process.argv[2] ?? "image";
  if (value !== "image" && value !== "pdf") {
    throw new Error(`unknown modality ${value}: expected image or pdf`);
  }
  return value;
}

function attachment(kind: Modality): Attachment {
  const chosen: Attachment =
    kind === "image"
      ? { path: join(ASSETS, "langwatch-shapes.png"), mediaType: "image/png" }
      : {
          path: join(ASSETS, "langwatch-invoice.pdf"),
          mediaType: "application/pdf",
        };
  if (!existsSync(chosen.path)) {
    // The fixtures are generated, not committed. The Python cells build them
    // on demand; from here the generator has to be run once by hand.
    throw new Error(
      `missing ${chosen.path}: run "uv run --with pillow --with reportlab python ../python/make_assets.py" first`,
    );
  }
  return chosen;
}

function question(kind: Modality): string {
  return kind === "image"
    ? "What does this image show? Name the words and the shapes."
    : "What is the invoice number and the total due in this document?";
}

function requireEnv(...names: string[]): void {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`missing environment: ${missing.join(", ")}`);
  }
}

async function ask(kind: Modality): Promise<string> {
  const { path, mediaType } = attachment(kind);
  const data = readFileSync(path).toString("base64");
  const filename = path.split("/").pop();

  const result = await generateText({
    model: openai.chat(MODEL),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: question(kind) },
          { type: "file", data, mediaType, filename },
        ],
      },
    ],
    experimental_telemetry: {
      isEnabled: true,
      metadata: { labels: ["multimodal-dogfood", "vercel-ai", kind] },
    },
  });

  return result.text;
}

requireEnv("OPENAI_API_KEY", "LANGWATCH_API_KEY");
setupObservability({ serviceName: "multimodal-dogfood" });

const which = modality();
const answer = await ask(which);
console.log(`[vercel-ai/${which}] ${answer.trim().slice(0, 280)}`);
