/**
 * The routing handle: the name that addresses ONE model provider instance in a
 * gateway model string.
 *
 * A provider family prefix names a KIND. With two Anthropic instances on one
 * key, "anthropic/claude-sonnet-5" matches both and the key's chain order
 * decides which one serves the request, which nothing in the product used to
 * state. A handle is the missing name: the operator picks it, it is unique
 * inside the organization, and "eu/claude-sonnet-5" reaches that exact row.
 *
 * The gateway reads a handle BEFORE a provider family, so a handle that spells
 * a family would shadow the family for the whole organization. Rather than
 * rely on the read order for that, the write refuses those names outright.
 */
import { modelProviders } from "./registry";

/** Longest handle we store. Long enough to be descriptive, short enough to type. */
export const ROUTING_HANDLE_MAX_LENGTH = 32;

/**
 * Lowercase, starts with a letter or digit, then letters, digits, hyphens and
 * underscores. The same shape as the provider family spellings it sits beside,
 * so a model string reads consistently whichever kind of prefix it carries.
 */
const ROUTING_HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** Spelled out for the customer, since the pattern itself is not copy. */
export const ROUTING_HANDLE_RULE =
  "A routing handle starts with a letter or a number, then uses only letters, numbers, hyphens and underscores, up to 32 characters.";

/**
 * Names a handle may never take.
 *
 * Every provider family key in the registry, plus the alternative spellings the
 * gateway accepts for the same families (SDKs emit "vertex_ai" and
 * "azure_openai", and the gateway normalises them), plus "mp", which prefixes
 * the application's own model wire format.
 *
 * Kept in step with the gateway's own closed family vocabulary in
 * services/aigateway/domain/provider.go. A name in one list and not the other
 * is a name that means two things.
 */
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

/** Why a handle was refused, so the caller is told the thing they can fix. */
export type RoutingHandleProblem = "shape" | "reserved";

/**
 * Reads a submitted handle into what gets stored.
 *
 * Blank input, in any of the shapes a form can produce it, clears the handle.
 * That is a real operation: it releases the name for another provider in the
 * organization.
 */
export function normalizeRoutingHandle(
  input: string | null | undefined,
): string | null {
  if (input == null) return null;
  const trimmed = input.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * Checks a normalized handle, returning the problem or null when it is fine.
 * Callers turn the problem into the customer-facing refusal; this function
 * stays free of copy so the same rule can be applied anywhere.
 */
export function routingHandleProblem(
  handle: string | null,
): RoutingHandleProblem | null {
  if (handle === null) return null;
  if (
    handle.length > ROUTING_HANDLE_MAX_LENGTH ||
    !ROUTING_HANDLE_PATTERN.test(handle)
  ) {
    return "shape";
  }
  if (RESERVED_ROUTING_HANDLES.has(handle)) return "reserved";
  return null;
}

/**
 * Reads a database error as "that routing handle is taken".
 *
 * Prisma reports a unique-index violation as P2002 and names the index it hit,
 * but WHERE it names it moves between versions and between an index declared
 * in the schema and one created in raw SQL (`meta.target`, or a nested
 * `meta.constraint.index`). The whole of `meta` is searched for the column
 * name rather than one field, so a Prisma upgrade cannot quietly turn this
 * refusal back into an unhandled crash. Still scoped: it fires only on P2002,
 * and only when the routing-handle index is the one named, so a collision on
 * another unique index is never reported as a handle conflict.
 */
export function isRoutingHandleConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, meta } = error as { code?: unknown; meta?: unknown };
  if (code !== "P2002" || meta == null) return false;
  return describeMeta(meta).includes("routinghandle");
}

/** Flattens an error's `meta` to lowercase text so a name can be looked for. */
function describeMeta(meta: unknown): string {
  try {
    return JSON.stringify(meta).toLowerCase();
  } catch {
    return String(meta).toLowerCase();
  }
}
