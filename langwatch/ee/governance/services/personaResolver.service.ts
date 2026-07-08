// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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
 * land on `/[project]`. The persona-4 gate is therefore conjunctive
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

import type { OrganizationIntent } from "@prisma/client";

export type Persona =
  | "personal_only"
  | "mixed"
  | "project_only"
  | "governance_admin";

export interface PersonaResolverInput {
  /**
   * The organization's declared primary intent (ADR-038). When set it ALONE
   * decides the destination kind — AGENT_GOVERNANCE → /me, LLM_OPS → the
   * project home — and beats the user pin and persona detection. NULL means
   * intent unset (legacy orgs): everything below behaves exactly as before.
   */
  organizationIntent: OrganizationIntent | null;

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
   * True when `release_ui_ai_governance_enabled` is on for this org. The
   * `/me` and `/governance` surfaces are gated behind this flag and 404
   * when it is off, so the resolver must never auto-route there for an org
   * without it — it falls back to the project home (the pre-governance
   * LLMOps experience). A user-pinned `lastHomePath` still wins, since a
   * pin can only have been set while the surface was reachable.
   */
  hasGovernanceUi: boolean;

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
  /**
   * Mirrors the input `hasGovernanceUi`. Lets the `/` redirect client gate
   * its own `lastVisitedHomeKind === "personal"` fallback so it never
   * overrides to `/me` when that surface is flag-gated off for the org.
   */
  governanceUiEnabled: boolean;
  /**
   * True when the org's primaryIntent decided the destination (ADR-038).
   * The client redirect layer must then keep the destination KIND — it may
   * substitute which project for a project-kind destination, but never flip
   * between /me and a project home. Distinct from `isOverride`, which keeps
   * meaning "user set an explicit pin".
   */
  intentPinned: boolean;
}

export function resolvePersonaHome(
  input: PersonaResolverInput,
): PersonaResolution {
  const persona = detectPersona(input);

  // ADR-038: a set org intent decides the landing before everything else,
  // including the user pin. Persona is still detected (HomePagePicker
  // consumes it) but never influences the destination here. The
  // hasGovernanceUi check is the I8 kill-switch guard: a flag-off
  // AGENT_GOVERNANCE org falls back to the project home, never a 404'd /me.
  if (input.organizationIntent) {
    const projectHome = input.firstProjectSlug
      ? `/${input.firstProjectSlug}`
      : noProjectFallback(input.hasGovernanceUi);
    const destination =
      input.organizationIntent === "AGENT_GOVERNANCE" && input.hasGovernanceUi
        ? "/me"
        : projectHome;
    return {
      persona,
      destination,
      isOverride: false,
      governanceUiEnabled: input.hasGovernanceUi,
      intentPinned: true,
    };
  }

  if (input.userLastHomePath) {
    return {
      persona,
      destination: input.userLastHomePath,
      isOverride: true,
      governanceUiEnabled: input.hasGovernanceUi,
      intentPinned: false,
    };
  }

  return {
    persona,
    destination: mapPersonaToDestination(persona, input),
    isOverride: false,
    governanceUiEnabled: input.hasGovernanceUi,
    intentPinned: false,
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
      organizationIntent: input.organizationIntent ?? null,
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
      hasGovernanceUi: input.hasGovernanceUi ?? false,
      firstProjectSlug: input.firstProjectSlug,
    };
    return resolvePersonaHome(full);
  } catch {
    return {
      persona: "project_only",
      destination: input.firstProjectSlug
        ? `/${input.firstProjectSlug}`
        : "/me",
      isOverride: false,
      governanceUiEnabled: input.hasGovernanceUi ?? false,
      intentPinned: false,
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
  const projectHome = input.firstProjectSlug
    ? `/${input.firstProjectSlug}`
    : noProjectFallback(input.hasGovernanceUi);

  // `/me` and `/governance` are gated behind release_ui_ai_governance_enabled
  // and 404 when it is off. An org without the governance UI gets the
  // pre-governance project home, no matter the detected persona — this is
  // what keeps an impersonated (or freshly signed-in) non-governance
  // customer off the dead-end /me page.
  if (!input.hasGovernanceUi) {
    return projectHome;
  }

  switch (persona) {
    case "governance_admin":
      return "/governance";
    case "personal_only":
    case "mixed":
      return "/me";
    case "project_only":
      return projectHome;
  }
}

/**
 * Where to send a user with no project membership. `/me` is the natural
 * personal home, but it is flag-gated and 404s without the governance UI, so
 * a non-governance org with no project falls back to the recoverable
 * onboarding bootstrap instead (mirrors the org-less branch in
 * pages/index.tsx) rather than the dead-end /me.
 */
function noProjectFallback(hasGovernanceUi: boolean): string {
  return hasGovernanceUi ? "/me" : "/onboarding/welcome";
}
