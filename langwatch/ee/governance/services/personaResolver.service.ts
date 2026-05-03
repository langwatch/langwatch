/**
 * PersonaResolverService — picks the right home destination for a user
 * landing on `/`.
 *
 * Four personas:
 *   1. personal_only      — user has a personal VK, no project membership
 *   2. mixed              — user has both personal VK + project membership
 *   3. project_only       — current LLMOps customer (DEFAULT — must not regress)
 *   4. governance_admin   — org admin on Enterprise + governance ingest active
 *
 * Critical invariant per rchaves directive 2026-04-29: most current LangWatch
 * customers are LLMOps admins NOT using the AI Gateway. They must continue to
 * land on `/[project]/messages`. The persona-4 gate is therefore conjunctive
 * (org-manage permission AND Enterprise plan AND hasIngestionSources) — any
 * single signal missing falls through to project_only.
 *
 * Override: User.lastHomePath (when set, wins over persona detection).
 *
 * Fail-safe: any signal lookup error → fall through to project_only home (or
 * `/me` if no projects). The LLMOps majority experience is preserved on
 * transient backend errors.
 *
 * Pairs with:
 *   - specs/ai-gateway/governance/persona-home-resolver.feature
 *   - .monitor-logs/lane-b-jane-storyboard-ui-delta.md §2 (decision rationale)
 */

export type Persona =
  | "personal_only"
  | "mixed"
  | "project_only"
  | "governance_admin";

export interface PersonaResolverInput {
  /** User pin override — when set, wins over persona detection. */
  userLastHomePath: string | null;

  /** From GovernanceSetupStateService.resolve() — already shipped. */
  setupState: {
    hasPersonalVKs: boolean;
    hasIngestionSources: boolean;
    hasRecentActivity: boolean;
  };

  /**
   * Pending Sergey lane-S delta (~30min effort): a flag for "this org has
   * ANY application trace ingestion." Until shipped, callers should pass
   * the result of a Project.findFirst({ where: { team: { organizationId },
   * lastEventAt: { not: null } } }) probe.
   *
   * Used to detect persona-3 (project-only LLMOps) cleanly without per-
   * project fan-out queries.
   */
  hasApplicationTraces: boolean;

  /** True when the user has the `organization:manage` permission. */
  hasOrganizationManagePermission: boolean;

  /** True when the org is on the Enterprise plan. */
  isEnterprise: boolean;

  /**
   * The user's first project slug, or null if the user has no project
   * memberships. Drives the project_only destination + the personal_only
   * vs mixed fork.
   */
  firstProjectSlug: string | null;
}

export interface PersonaResolution {
  persona: Persona;
  destination: string;
  /** True when User.lastHomePath was set and used. */
  isOverride: boolean;
}

export function resolvePersonaHome(
  input: PersonaResolverInput,
): PersonaResolution {
  const persona = detectPersona(input);

  if (input.userLastHomePath) {
    return {
      persona,
      destination: input.userLastHomePath,
      isOverride: true,
    };
  }

  return {
    persona,
    destination: mapPersonaToDestination(persona, input),
    isOverride: false,
  };
}

/**
 * Best-effort wrapper. Falls back to project_only (or /me when no project
 * slug is available) on any error. Use at the tRPC boundary to guarantee
 * the LLMOps majority experience never breaks on transient backend errors.
 */
export function resolvePersonaHomeSafe(
  input: Partial<PersonaResolverInput> & { firstProjectSlug: string | null },
): PersonaResolution {
  try {
    const full: PersonaResolverInput = {
      userLastHomePath: input.userLastHomePath ?? null,
      setupState: input.setupState ?? {
        hasPersonalVKs: false,
        hasIngestionSources: false,
        hasRecentActivity: false,
      },
      hasApplicationTraces: input.hasApplicationTraces ?? false,
      hasOrganizationManagePermission:
        input.hasOrganizationManagePermission ?? false,
      isEnterprise: input.isEnterprise ?? false,
      firstProjectSlug: input.firstProjectSlug,
    };
    return resolvePersonaHome(full);
  } catch {
    return {
      persona: "project_only",
      destination: input.firstProjectSlug
        ? `/${input.firstProjectSlug}/messages`
        : "/me",
      isOverride: false,
    };
  }
}

function detectPersona(input: PersonaResolverInput): Persona {
  // Persona 4 first — conjunctive gate prevents accidentally routing
  // LLMOps admins onto /governance when the org has no governance state.
  const governanceAdminGate =
    input.hasOrganizationManagePermission &&
    input.isEnterprise &&
    input.setupState.hasIngestionSources;
  if (governanceAdminGate) return "governance_admin";

  if (input.setupState.hasPersonalVKs && input.firstProjectSlug) {
    return "mixed";
  }
  if (input.setupState.hasPersonalVKs) {
    return "personal_only";
  }

  // Persona 3 — the LLMOps majority. Default for any user who doesn't
  // match personas 1, 2, or 4.
  return "project_only";
}

function mapPersonaToDestination(
  persona: Persona,
  input: PersonaResolverInput,
): string {
  switch (persona) {
    case "governance_admin":
      return "/governance";
    case "personal_only":
    case "mixed":
      return "/me";
    case "project_only":
      return input.firstProjectSlug
        ? `/${input.firstProjectSlug}/messages`
        : "/me";
  }
}
