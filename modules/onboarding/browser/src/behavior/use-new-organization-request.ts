/**
 * A member of an organization creating another one from the organization menu.
 * @see specs/features/onboarding/intent-fork.feature
 */
import { useRouter } from "@langwatch/browser-host/use-router";
import { useEffect } from "react";

import type { GuidedOrganization } from "../features/guided-onboarding/behavior/use-guided-organization-create.ts";
import { useOnboardingHost } from "../model/onboarding-host.ts";
import { NEW_ORGANIZATION_PARAM, readNewOrganizationRequest } from "../model/welcome-redirect.ts";
import { api } from "./onboarding-api.ts";

/**
 * "/" resolves the organization from the remembered selection, which still names the one the
 * member came from; `?org=<slug>` selects the new one first (org-query-param-switch.feature).
 */
const SCOPE_GRAPH_ATTEMPTS = 3;

export async function selectingNewOrganization({
  landing,
  organizationId,
  fetchScopeGraph,
}: {
  landing: string;
  organizationId: string;
  fetchScopeGraph: () => Promise<readonly { id: string; slug: string }[]>;
}): Promise<string> {
  if (landing !== "/") return landing;
  for (let attempt = 0; attempt < SCOPE_GRAPH_ATTEMPTS; attempt++) {
    const organizations = await fetchScopeGraph().catch(() => []);
    const slug = organizations.find((org) => org.id === organizationId)?.slug;
    if (slug) return `/?org=${encodeURIComponent(slug)}`;
  }
  // The organization exists either way; home in the remembered one beats a page with no way out.
  return landing;
}

export function useNewOrganizationRequest({ created }: { created: GuidedOrganization | null }): {
  wantsNewOrganization: boolean;
  /** Asked and nothing created yet; once it exists, its own resume or landing decides. */
  asksForNewOrganizationForm: boolean;
  /** The organization this page created for the request, also after a reload. */
  createdOrganizationId: string | undefined;
  landAfterCreate: (input: { landing: string; organizationId: string }) => void;
} {
  const host = useOnboardingHost();
  const router = useRouter();
  const utils = api.useUtils();
  const request = readNewOrganizationRequest(router.query[NEW_ORGANIZATION_PARAM]);
  const recordedId = request.createdOrganizationId;

  useEffect(() => {
    // The created organization goes in the address, so a reload resumes it instead of a new form.
    if (!request.wanted || !created || recordedId) return;
    // setQuery takes the whole next query, so the rest of the address is carried over.
    host.setQuery(
      { ...host.route().query, [NEW_ORGANIZATION_PARAM]: created.organizationId },
      { replace: true },
    );
  }, [request.wanted, created, recordedId, host]);

  const landAfterCreate = ({
    landing,
    organizationId,
  }: {
    landing: string;
    organizationId: string;
  }) => {
    if (!request.wanted) {
      host.hardRedirect(landing);
      return;
    }
    void selectingNewOrganization({
      landing,
      organizationId,
      // A cached graph predates the organization just created, so it is asked again.
      fetchScopeGraph: () => utils.organization.getScopeGraph.fetch({}, { staleTime: 0 }),
    }).then((to) => host.hardRedirect(to));
  };

  const createdOrganizationId = created?.organizationId ?? recordedId;
  return {
    wantsNewOrganization: request.wanted,
    asksForNewOrganizationForm: request.wanted && !createdOrganizationId,
    createdOrganizationId,
    landAfterCreate,
  };
}
