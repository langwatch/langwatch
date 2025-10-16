import type { FrameworkKey, PlatformKey, Option } from "./types";

export const PLATFORM_OPTIONS: Option<PlatformKey>[] = [
  { key: "typescript", label: "TypeScript", icon: <img src="/images/external-icons/typescript.svg" alt="TypeScript" /> },
  { key: "python", label: "Python", icon: <img src="/images/external-icons/python.svg" alt="Python" /> },
  { key: "go", label: "Go", icon: <img src="/images/external-icons/golang.svg" alt="Go" /> },
  { key: "opentelemetry", label: "OpenTelemetry", icon: <img src="/images/external-icons/otel.svg" alt="OpenTelemetry" /> },
  { key: "no_and_lo", label: "No and Low Code", icon: <img src="/images/external-icons/no-and-lo.svg" alt="No and Low Code" /> },
  { key: "other", label: "Other" },
];

export const FRAMEWORKS_BY_PLATFORM: Partial<Record<PlatformKey, Option<FrameworkKey>[]>> = {
  typescript: [
    { key: "vercel_ai", label: "Vercel AI", icon: <img src="/images/external-icons/vercel-darktheme.svg" alt="Vercel AI" />, size: "2xl" },
    { key: "mastra", label: "Mastra", icon: <img src="/images/external-icons/mastra-darktheme.svg" alt="Mastra" />, size: "2xl" },
    { key: "langchain", label: "LangChain", icon: <img src="/images/external-icons/langchain-darktheme.svg" alt="LangChain" />, size: "2xl" },
    { key: "openai", label: "OpenAI", icon: <img src="/images/external-icons/openai-darktheme.svg" alt="OpenAI" />, size: "xl" },
  ],
  python: [],
  go: [],
  opentelemetry: [],
};

export function platformToFileName(key: PlatformKey): string {
  switch (key) {
    case "typescript":
      return "app.ts";
    case "python":
      return "app.py";
    case "go":
      return "main.go";
    case "opentelemetry":
      return "opentelemetry.yaml";
    default:
      return "";
  }
}


