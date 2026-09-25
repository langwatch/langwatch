import type { AuthzPermission } from "@langwatch/authz";
import type { z } from "zod";
import {
  WORKBENCH_ACTIONS,
  type WorkbenchActionDefinition,
} from "~/experiments-v3/actions/manifest";
import { EXPLORER_ACTIONS } from "~/features/traces-v2/actions/manifest";

/**
 * The server's own registry of every page action an agent may dispatch.
 *
 * The browser registers handlers per page, but the SERVER decides what exists:
 * a kind is only dispatchable when it appears here, and its payload is parsed
 * with the schema HERE before anything reaches the stream. The client-asserted
 * registration is never consulted for validation. A kind's domain prefix
 * (`workbench.`, `explorer.`) names the page family it belongs to, which is how the turn
 * context knows to advertise the channel when a matching context chip is
 * attached.
 *
 * The manifest modules themselves are framework-free on purpose (see
 * `experiments-v3/actions/manifest.ts` and
 * `features/traces-v2/actions/manifest.ts`), so importing them here pulls no React
 * into the server graph; `src/server/__tests__/frontend-boundary.unit.test.ts`
 * enforces that transitively.
 */
export type PageActionDefinition = Pick<
  WorkbenchActionDefinition,
  "payloadSchema" | "resultSchema" | "executeBudgetMs" | "backend" | "transform"
> & { requiredPermission: AuthzPermission };

export const PAGE_ACTION_MANIFESTS: Record<
  string,
  Record<string, PageActionDefinition>
> = {
  workbench: WORKBENCH_ACTIONS,
  explorer: EXPLORER_ACTIONS,
};

/** Context-chip kinds that mean "the user is on a page with this manifest". */
export const CHIP_KIND_TO_MANIFEST: Record<string, string> = {
  experiment: "workbench",
  // The Trace Explorer's view chip and its applied-search chip are both
  // `filter` chips, and its selection chip is a `selection` chip. The caller
  // route-gates all three to the traces page, so either one on a turn means
  // the Explorer is what the user is looking at.
  filter: "explorer",
  selection: "explorer",
};

/** Look one action kind up across every page manifest. */
export function findPageAction(kind: string): PageActionDefinition | null {
  const domain = kind.split(".")[0];
  if (!domain) return null;
  const manifest = PAGE_ACTION_MANIFESTS[domain];
  if (!manifest) return null;
  return manifest[kind] ?? null;
}

/** Every dispatchable kind with its schema, for the `ui actions` listing. */
export function listPageActions(): Array<{
  kind: string;
  requiredPermission: AuthzPermission;
  backend: PageActionDefinition["backend"];
  payloadSchema: z.ZodTypeAny;
}> {
  return Object.values(PAGE_ACTION_MANIFESTS).flatMap((manifest) =>
    Object.entries(manifest).map(([kind, def]) => ({
      kind,
      requiredPermission: def.requiredPermission,
      backend: def.backend,
      payloadSchema: def.payloadSchema,
    })),
  );
}
