import { WORKBENCH_ACTIONS } from "@langwatch/experiment-contract";
import { LangyUiActionUnknownError, type LangyUiActionListing } from "@langwatch/langy-contract";
import { EXPLORER_ACTIONS } from "@langwatch/trace-contract";
import { z } from "zod";

import type { LangyUiActionCatalog, LangyUiActionDefinition } from "../app/langy.members.ts";

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
