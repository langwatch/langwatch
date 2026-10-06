import type { AuthzPermission } from "@langwatch/authorization";
import { WORKBENCH_ACTIONS } from "@langwatch/experiment-contract";
import { LangyUiActionUnknownError, type LangyUiActionListing } from "@langwatch/langy-contract";
import { EXPLORER_ACTIONS } from "@langwatch/trace-contract";
import { z } from "zod";

import type { LangyUiActionBackendMode } from "./langy-ui-action-backend.service.ts";

/**
 * One dispatchable action, as the channel needs it. Structural rather than
 * imported from the declaring workbench, to avoid the cross-feature reach
 * this port exists to prevent.
 */
export type LangyUiActionDefinition = Readonly<{
  /**
   * Parses the dispatched payload; a failure is refused, never forwarded.
   * Discriminated result rather than a Zod type, to keep the schema library
   * the catalogue's own business.
   */
  payloadSchema: {
    safeParse(
      value: unknown,
    ): { success: true; data: unknown } | { success: false; error: { issues: readonly unknown[] } };
  };
  /** What the page is expected to answer with. Declared, not enforced here. */
  resultSchema?: unknown;
  /** How long the page has to finish, before the channel's own ceiling. */
  executeBudgetMs?: number;
  /** Whether an away page can be stood in for by a backend run, and how. */
  backend?: LangyUiActionBackendMode;
  /**
   * The saved-state rewrite a backend run applies, where one exists. Declared
   * as a method so a page family's own transform, which reads a state type
   * this package never names, satisfies it.
   */
  transform?(args: { state: unknown; payload: unknown }): {
    state: unknown;
    result?: unknown;
  };
  /** The permission the DOOR enforces before a dispatch reaches this service. */
  requiredPermission: AuthzPermission;
}>;

/** Looks one action kind up across every page family this process serves.
 * Rejects an unknown kind with `LangyUiActionUnknownError` rather than
 * answering null: a dispatch naming a kind this process does not serve is a
 * client mistake, not a normal absence. */
export interface LangyUiActionCatalog {
  getByKind(kind: string): LangyUiActionDefinition;
}

/**
 * The server's own registry of every page action an agent may dispatch: a kind is dispatchable
 * only when it appears here, and its payload is parsed with the schema HERE. A kind's domain
 * prefix (`workbench.`, `explorer.`) names the page family it belongs to.
 */
const PAGE_ACTION_MANIFESTS = {
  workbench: WORKBENCH_ACTIONS,
  explorer: EXPLORER_ACTIONS,
} as const;

type PageManifest = (typeof PAGE_ACTION_MANIFESTS)[keyof typeof PAGE_ACTION_MANIFESTS];

function manifestFor(kind: string): Readonly<Record<string, LangyUiActionDefinition>> {
  const domain = kind.split(".")[0] ?? "";
  const families: Readonly<Record<string, PageManifest>> = PAGE_ACTION_MANIFESTS;
  return families[domain] ?? {};
}

/** Every page family's actions, looked up by kind and listed for `langwatch ui actions`. */
export class LangyUiActionCatalogService implements LangyUiActionCatalog {
  static create(): LangyUiActionCatalogService {
    return new LangyUiActionCatalogService();
  }

  private constructor() {}

  /** Refuses a kind no page family serves: naming one is a client mistake, not an absence. */
  getByKind(kind: string): LangyUiActionDefinition {
    const definition = manifestFor(kind)[kind];
    if (!definition) throw new LangyUiActionUnknownError(kind);
    return definition;
  }

  /**
   * Each kind with its own payload schema, rendered by Zod as draft-07 and inlined: the document
   * the CLI reads is the one this surface has always published.
   */
  list(): LangyUiActionListing[] {
    return Object.values(PAGE_ACTION_MANIFESTS).flatMap((manifest) =>
      Object.entries(manifest).map(([kind, definition]) => ({
        kind,
        permission: definition.requiredPermission,
        backend: definition.backend,
        payloadSchema: z.toJSONSchema(definition.payloadSchema, {
          target: "draft-07",
          reused: "inline",
        }),
      })),
    );
  }
}
