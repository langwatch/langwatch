import { modelProviders } from "./model-provider-registry";
import { ROUTING_HANDLE_MAX_LENGTH, ROUTING_HANDLE_RULE } from "./model-provider";

export { ROUTING_HANDLE_MAX_LENGTH, ROUTING_HANDLE_RULE };

const ROUTING_HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export const RESERVED_ROUTING_HANDLES: ReadonlySet<string> = new Set([
  ...Object.keys(modelProviders),
  "azure_openai",
  "aws_bedrock",
  "vertex",
  "google_vertex",
  "google_gemini",
  "cloudflare",
  "mp",
]);

export type RoutingHandleProblem = "shape" | "reserved";

export function normalizeRoutingHandle(input: string | null | undefined): string | null {
  if (input === null || input === undefined) {
    return null;
  }

  const handle = input.trim().toLowerCase();
  return handle === "" ? null : handle;
}

export function sanitizeRoutingHandleInput(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[_-]+/, "")
    .slice(0, ROUTING_HANDLE_MAX_LENGTH);
}

export function routingHandleProblem(handle: string | null): RoutingHandleProblem | null {
  if (handle === null) {
    return null;
  }

  if (handle.length > ROUTING_HANDLE_MAX_LENGTH || !ROUTING_HANDLE_PATTERN.test(handle)) {
    return "shape";
  }

  return RESERVED_ROUTING_HANDLES.has(handle) ? "reserved" : null;
}
