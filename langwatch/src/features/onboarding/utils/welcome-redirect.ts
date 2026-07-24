/**
 * Pure decision for the welcome screen's mount effect: does this user need
 * onboarding, or where do they go instead? (ADR-038 v6)
 *
 * - An intent-set org is onboarded, period: never show the create-org form
 *   again (it would mint a duplicate org) — send home and let the resolver
 *   pick /me, the project, or /settings.
 * - Personal-workspace teams never count as onboarded projects and are
 *   never a redirect target.
 */

interface WelcomeOrg {
  primaryIntent: string | null;
  teams: { isPersonal: boolean; projects: { slug: string }[] }[];
}

export type WelcomeRedirectDecision =
  | { kind: "onboard" }
  | { kind: "home" }
  | { kind: "project"; slug: string };

export function resolveWelcomeRedirect({
  organizations,
  currentProjectSlug,
}: {
  organizations: WelcomeOrg[] | undefined;
  currentProjectSlug: string | null;
}): WelcomeRedirectDecision {
  const sharedTeams = (org: WelcomeOrg) =>
    org.teams.filter((t) => !t.isPersonal);

  const hasAnyProject =
    organizations?.some((org) =>
      sharedTeams(org).some((t) => t.projects.length > 0),
    ) ?? false;

  const hasIntentSetOrg =
    organizations?.some((org) => org.primaryIntent != null) ?? false;

  if (!hasAnyProject && hasIntentSetOrg) return { kind: "home" };
  if (!hasAnyProject) return { kind: "onboard" };

  const slug =
    currentProjectSlug ??
    organizations
      ?.flatMap((o) => sharedTeams(o))
      .flatMap((t) => t.projects)[0]?.slug;

  return slug ? { kind: "project", slug } : { kind: "onboard" };
}
