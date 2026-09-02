/**
 * The server's own registry of every page action an agent may dispatch.
 *
 * The browser registers handlers per page, but the SERVER decides what exists:
 * a kind is only dispatchable when this catalogue names it, and its payload is
 * parsed with the schema the catalogue holds before anything reaches the
 * stream. The client-asserted registration is never consulted for validation.
 *
 * It is a port rather than a module inside this package because the only
 * catalogue that exists belongs to the experiments workbench, and a Langy
 * server package may not reach into another feature's. A kind's domain prefix
 * (`workbench.`) names the page family it belongs to; which context-chip kinds
 * sit on such a page is `LANGY_UI_ACTION_CHIP_KINDS`
 * (`@langwatch/langy-contract`), read by the turn block that advertises the
 * channel.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";

/**
 * One dispatchable action, as the channel needs it.
 *
 * Structural rather than imported from the workbench that declares it: the
 * five fields below are everything the dispatch reads, and naming the
 * workbench's own type here would be the cross-feature reach this port exists
 * to avoid.
 */
export type LangyUiActionDefinition = Readonly<{
  /**
   * Parses the dispatched payload. A failure is refused, never forwarded.
   *
   * A discriminated result rather than a Zod type: this package parses nothing
   * of its own here and only reads the two branches, so declaring the shape it
   * reads keeps the catalogue's own schema library the catalogue's business.
   */
  payloadSchema: {
    safeParse(value: unknown):
      | { success: true; data: unknown }
      | { success: false; error: { issues: readonly unknown[] } };
  };
  /** What the page is expected to answer with. Declared, not enforced here. */
  resultSchema?: unknown;
  /** How long the page has to finish, before the channel's own ceiling. */
  executeBudgetMs?: number;
  /** Whether an away page can be stood in for by a backend run, and how. */
  backend?: unknown;
  /** The saved-state rewrite a backend run applies, where one exists. */
  transform?: unknown;
  /** The permission the DOOR enforces before a dispatch reaches this service. */
  requiredPermission: AuthzPermission;
}>;

/** Looks one action kind up across every page family this process serves. */
export abstract class LangyUiActionCatalogPort {
  abstract tryFind(kind: string): LangyUiActionDefinition | null;
}
