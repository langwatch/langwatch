import type { TriggerAction } from "@prisma/client";
import type { SharedDef } from "~/shared/automations/providers/types";

/**
 * Server-side halves of the automation provider system. A ServerDef owns the
 * at-rest lifecycle of its `actionParams`: how a wire payload becomes a
 * stored row (secrets encrypted, kept sentinels resolved) and how a stored
 * row is stripped before it returns to the browser. Providers without
 * secrets omit both hooks and the registry applies the identity.
 *
 * Dispatch + test-fire bodies still live on the dispatch path (Stage B of
 * the provider model moves them in here).
 */

export interface PersistActionParamsArgs {
  /** Schema-parsed wire actionParams for this provider. */
  incoming: unknown;
  /** Lazily loads the saved row's stored actionParams (or undefined when
   *  creating). Providers call it only when they actually need the stored
   *  secrets — e.g. a kept sentinel to resolve — so plain saves skip the
   *  extra read. */
  loadExisting: () => Promise<unknown>;
}

export interface ServerDef {
  /** Discriminator stored on the Trigger row. */
  readonly action: TriggerAction;
  /** Transform wire actionParams into their at-rest shape. Throws a
   *  `HandledError` subclass for user-facing validation failures. */
  persistActionParams?(args: PersistActionParamsArgs): Promise<unknown>;
  /** Strip secrets before a stored row leaves the server. */
  redactActionParams?(params: unknown): unknown;
}

export interface ServerEntry {
  shared: SharedDef;
  server: ServerDef;
}
