import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { useLocalStorage } from "usehooks-ts";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * One-shot `?org=<slug>` organization switch for org-scoped pages.
 *
 * Org-scoped pages (`/me`, `/settings/*`, `/governance`, the gateway pages)
 * resolve the active organization from the `selectedOrganizationId` localStorage
 * key, not the URL — so a multi-org user can't express "show THIS org's page" in
 * a link, and the workspace switcher's per-org "My Workspace" entries need a
 * target that selects the right org before landing.
 *
 * This hook reads `?org=<slug>`; when it names an organization the user belongs
 * to, it selects that org (writes `selectedOrganizationId`, which usehooks-ts
 * broadcasts so every reader re-resolves in-tab) and then strips the parameter
 * so the address bar returns to the clean, memorable path. An `?org` for an org
 * the user is not a member of is ignored (no switch) but still stripped, so a
 * stale or hostile slug can't linger or loop. Other query parameters and the
 * path are preserved.
 *
 * Mounted once in DashboardLayout so every org-scoped page gets the behaviour.
 *
 * Spec: specs/ai-gateway/governance/org-query-param-switch.feature
 */
export function useOrgQueryParamSelection(): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const { organizations } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const [, setSelectedOrganizationId] = useLocalStorage<string>(
    "selectedOrganizationId",
    "",
  );

  const orgParam = searchParams.get("org");

  useEffect(() => {
    if (!orgParam) return;
    // Wait until the org list has loaded so membership can be validated; the
    // effect re-runs and strips once `organizations` resolves.
    if (!organizations) return;

    const match = organizations.find((org) => org.slug === orgParam);
    if (match) {
      setSelectedOrganizationId(match.id);
    }

    // Strip `?org` whether it was applied or ignored, preserving every other
    // parameter, so it neither lingers in the URL nor re-triggers this effect.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("org");
        return next;
      },
      { replace: true },
    );
  }, [orgParam, organizations, setSelectedOrganizationId, setSearchParams]);
}
