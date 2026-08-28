/**
 * The permission vocabulary custom roles are built from, as a port.
 *
 * The catalogue itself is application data — the resource and action lists the
 * settings UI, the RBAC resolver and the custom-role validator all read — and
 * the module that owns it also owns the legacy org-exclusive set the roles API
 * publishes. A transport package that imported it would drag the whole RBAC
 * tree behind `@langwatch/platform-api`, so the process hands the three facts
 * over instead and everything the `/api/roles` family publishes is derived
 * from them here.
 *
 * Both lists arrive in the order the process states them, and the published
 * catalogue preserves it: a caller that renders a permission picker from this
 * document sees the same order the settings UI does.
 */
export interface AppRestRbacVocabulary {
  /** Every action a permission may name, e.g. `view`, `manage`. */
  readonly actions: readonly string[];
  /** Every resource a permission may name, e.g. `organization`, `traces`. */
  readonly resources: readonly string[];
  /**
   * Whether the resource only takes effect at organization scope (ADR-021), so
   * a custom role listing one of its permissions cannot be bound at team or
   * project scope.
   */
  isOrganizationExclusive(resource: string): boolean;
}
