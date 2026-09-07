/**
 * Pure decision for the welcome screen's mount effect: does this user need
 * onboarding, or where do they go instead? (ADR-038 v6)
 *
 * - Belonging to an organization is what "already onboarded" means: never show
 *   the create-org form to a member of one (it would mint a duplicate org) —
 *   send them home and let the resolver pick /me, the project, or /settings.
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

  // Membership is the test, not `primaryIntent`. That field is null for every
  // organization created before ADR-038 and for every one created outside
  // onboarding, so a member invited into such an organization was shown "let's
  // kick off by creating your organization" with no way past it except making a
  // second organization nobody wanted. An organization with no shared project
  // yet is still an organization they belong to; where they land from here is
  // the home resolver's job.
  const belongsToAnOrganization = (organizations?.length ?? 0) > 0;

  if (!hasAnyProject) {
    return belongsToAnOrganization ? { kind: "home" } : { kind: "onboard" };
  }

  const slug =
    currentProjectSlug ??
    organizations?.flatMap((o) => sharedTeams(o)).flatMap((t) => t.projects)[0]
      ?.slug;

  // Only reachable with a shared project in hand, so with an organization too:
  // whatever happens to the slug, onboarding is not the answer.
  return slug ? { kind: "project", slug } : { kind: "home" };
}
