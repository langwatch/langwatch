/**
 * Decides if user needs onboarding or redirects based on org membership (see
 * ADR-038 v6).
 */

interface WelcomeOrg {
  primaryIntent: string | null;
  teams: readonly {
    readonly isPersonal: boolean;
    readonly projects: readonly { readonly slug: string }[];
  }[];
}

export type WelcomeRedirectDecision =
  | { kind: "onboard" }
  | { kind: "home" }
  | { kind: "project"; slug: string };

export function resolveWelcomeRedirect({
  organizations,
  currentProjectSlug,
}: {
  organizations: readonly WelcomeOrg[] | undefined;
  currentProjectSlug: string | null;
}): WelcomeRedirectDecision {
  const sharedTeams = (org: WelcomeOrg) => org.teams.filter((t) => !t.isPersonal);

  const hasAnyProject =
    organizations?.some((org) => sharedTeams(org).some((t) => t.projects.length > 0)) ?? false;

  // Membership is the test, not `primaryIntent` — that field is null for
  // organizations created before ADR-038 or outside onboarding, which showed
  // an invited member "let's kick off" with no way past it but a second,
  // unwanted organization. Belonging with no shared project yet still counts;
  // where they land from here is the home resolver's job.
  const belongsToAnOrganization = (organizations?.length ?? 0) > 0;

  if (!hasAnyProject) {
    return belongsToAnOrganization ? { kind: "home" } : { kind: "onboard" };
  }

  const slug =
    currentProjectSlug ??
    organizations?.flatMap((o) => sharedTeams(o)).flatMap((t) => t.projects)[0]?.slug;

  // Only reachable with a shared project in hand, so with an organization too:
  // whatever happens to the slug, onboarding is not the answer.
  return slug ? { kind: "project", slug } : { kind: "home" };
}
