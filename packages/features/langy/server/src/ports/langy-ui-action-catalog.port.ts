/**
 * Server's registry of dispatchable page actions; browser registration is
 * never consulted for validation. A port, not a module: the only catalogue
 * belongs to the experiments workbench, another feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";

/**
 * How an away page is stood in for: the saved document is read, rewritten by
 * the action's own transform, or run.
 */
export type LangyUiActionBackendMode = "read" | "transform" | "run";

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

/** Looks one action kind up across every page family this process serves. */
export abstract class LangyUiActionCatalogPort {
  abstract tryFind(kind: string): LangyUiActionDefinition | null;
}
