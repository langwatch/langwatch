/**
 * The release before plain JSON wrapped every tRPC input as `{ json, meta? }`.
 * A tab still open on it is refused with `client_outdated`, never served.
 */
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";

import { ClientOutdatedError } from "../errors.ts";

const ENVELOPE_KEYS = new Set(["json", "meta"]);

const logger = createLogger("langwatch:trpc");

/** Whether an input is the old transformer's envelope rather than plain JSON. */
export function isOutdatedClientInput(input: unknown): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;

  const keys = Object.keys(input);

  return keys.includes("json") && keys.every((key) => ENVELOPE_KEYS.has(key));
}

/** Runs ahead of `.input()`: an enveloped call is refused before its parser reads it. */
export async function refuseOutdatedClient({
  path,
  type,
  getRawInput,
  next,
}: {
  path: string;
  type: string;
  getRawInput: () => Promise<unknown>;
  next: () => Promise<unknown>;
}): Promise<unknown> {
  if (!isOutdatedClientInput(await getRawInput())) return next();

  logger.info({ path, type }, "An outdated client was told to reload");

  const refusal = new ClientOutdatedError();

  throw new TRPCError({ code: "BAD_REQUEST", message: refusal.code, cause: refusal });
}
