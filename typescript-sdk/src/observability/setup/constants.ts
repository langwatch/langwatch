import { version } from "../../../package.json";

export type JsRuntime = "node" | "deno" | "bun" | "web" | "unknown";

export const LANGWATCH_SDK_NAME = "langwatch-observability-sdk";
export const LANGWATCH_SDK_LANGUAGE = "typescript";
export const LANGWATCH_SDK_RUNTIME = detectRuntime();
export const LANGWATCH_SDK_VERSION = version;

export const DEFAULT_ENDPOINT = "https://app.langwatch.ai/";
export const DEFAULT_SERVICE_NAME = "langwatch-observed-service";

export const TRACES_PATH = "/api/otel/v1/traces";
export const LOGS_PATH = "/api/otel/v1/logs";
export const METRICS_PATH = "/api/otel/v1/metrics";

/**
 * Detects the JavaScript runtime environment.
 * @param globals - (Test only) Optionally override the global object for environment simulation. Only used if NODE_ENV === 'test'.
 */
export function detectRuntime(globals?: any): JsRuntime {
  let g = globalThis;
  if (globals) {
    if (process.env.NODE_ENV === "test") {
      g = globals;
    } else {
      console.warn("[LangWatch Observability] overriding detectRuntime is only supported when running in NODE_ENV=test");
    }
  }

  try {
    if (
      "Deno" in g &&
      typeof g.Deno === "object" &&
      g.Deno &&
      'version' in g.Deno &&
      typeof g.Deno.version === "object"
    ) {
      return "deno";
    }
    if (
      "Bun" in g &&
      typeof g.Bun === "object" &&
      g.Bun &&
      'version' in g.Bun &&
      typeof g.Bun.version === "string"
    ) {
      return "bun";
    }
    if (
      "process" in g &&
      typeof g.process === "object" &&
      g.process &&
      typeof g.process.versions === "object" &&
      typeof g.process.versions.node === "string"
    ) {
      return "node";
    }
    if (
      typeof g.window !== "undefined" &&
      typeof g.window.document !== "undefined" &&
      g === g.window
    ) {
      return "web";
    }
    return "unknown";
  } catch (error) {
    console.warn("[LangWatch Observability] Failed to detect runtime", error);
    return "unknown";
  }
}
