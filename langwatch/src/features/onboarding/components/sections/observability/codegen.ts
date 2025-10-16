import type { FrameworkKey, PlatformKey } from "./types";
import { platformToFileName } from "./constants";

interface CodegenResult {
  code: string;
  filename: string;
  highlightLines?: number[];
  codeLanguage: string;
}

export function getLanguageCode(language: PlatformKey): CodegenResult {
  switch (language) {
    case "typescript": {
      const code = `import { setupObservability } from "@langwatch/observability/node";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

setupObservability({
  // API key is automatically read from LANGWATCH_API_KEY
  langwatch: { apiKey: "<api_key>" },
  serviceName: "<project_name>",
});

async function main(message: string): Promise<string> {
  // Make the LLM call
  const response = await generateText({
    model: openai("gpt-5-mini"),
    prompt: message,
    experimental_telemetry: { isEnabled: true }, // Don't forget to enable telemetry!
  });

  return response.text;
}

console.log(await main("Hello, world!"));`;
      return {
        code,
        filename: platformToFileName(language),
        highlightLines: [1, 6, 7, 16],
        codeLanguage: "typescript",
      };
    }
    case "python":
      return { code: "# Integration snippet coming soon\n# Language: Python\n# Framework: None selected", filename: platformToFileName(language), codeLanguage: "python" };
    case "go":
      return { code: "// Integration snippet coming soon\n// Language: Go\n// Framework: None selected", filename: platformToFileName(language), codeLanguage: "go" };
    case "opentelemetry":
      return { code: "# Integration snippet coming soon\n# Language: OpenTelemetry\n# Framework: None selected", filename: platformToFileName(language), codeLanguage: "yaml" };
    default:
      return { code: "", filename: "", codeLanguage: "" } as CodegenResult;
  }
}

export function getFrameworkCode(language: PlatformKey, framework: FrameworkKey): CodegenResult {
  if (language === "typescript" && framework === "vercel_ai") {
    return getLanguageCode("typescript");
  }

  const base = getLanguageCode(language);
  const prefix = ["typescript", "go"].includes(language) ? "//" : "#";
  const frameworkLabel = framework.replaceAll("_", " ");
  return {
    code: `${prefix} Integration snippet coming soon\n${prefix} Language: ${capitalize(language)}\n${prefix} Framework: ${capitalize(frameworkLabel)}`,
    filename: base.filename,
    codeLanguage: base.codeLanguage,
  };
}

function capitalize(input: string): string {
  return input.length ? input.charAt(0).toUpperCase() + input.slice(1) : input;
}
