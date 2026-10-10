import { HandledError } from "@langwatch/handled-error";
import type { Context } from "hono";

/** The unvalidated envelope sent by react-admin's data provider. */
export type AdminDataRequest = {
  resource?: unknown;
  method?: unknown;
  params?: {
    filter?: { query?: unknown } & Record<string, unknown>;
    id?: unknown;
    data?: unknown;
  };
} & Record<string, unknown>;

/** A malformed JSON document cannot be handed to the resource dispatcher. */
export class AdminMalformedBodyError extends HandledError {
  declare readonly code: "malformed_request";

  constructor() {
    super("malformed_request", "Admin request body must be a JSON object", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "AdminMalformedBodyError";
  }
}

/** Parse an admin request body and reject JSON primitives and arrays. */
export async function readJsonBody(
  c: Pick<Context, "req">,
): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    throw new AdminMalformedBodyError();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AdminMalformedBodyError();
  }

  return parsed as Record<string, unknown>;
}

/** A caller-supplied field usable by an admin operation. */
export function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
