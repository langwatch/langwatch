/**
 * What the Integrations screen is mounted inside.
 *
 * Two things go around `/settings/integrations`: the tRPC Provider the
 * package's own hooks run on, and the host port that answers for the
 * organization, the address, the failure notice and the two departures.
 *
 * THE ORGANIZATION IS THE SESSION'S ACTIVE SCOPE. `platform/app` read it off
 * `useOrganizationTeamProject`, which resolves the whole organization graph for
 * one id; the capability layer already holds that id, so the screen is handed
 * it directly and no graph is fetched for this page at all.
 */

import { GithubHostProvider, type GithubHostPort } from "@langwatch/github-web/screens/integrations";
import { useMemo, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { uiLeaveTo, uiOpenExternal } from "../../../../behavior/ui-departure";

export function GithubHost({ children }: { children: ReactNode }) {
  const { session, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const reading = route.reading();

  const host = useMemo<GithubHostPort>(
    () => ({
      scope: () => ({ organizationId: scope.organizationId ?? void 0 }),
      route: () => reading,
      setQuery: (next, options) => route.setQuery(next, options),
      leaveTo: uiLeaveTo,
      openExternal: uiOpenExternal,
      failed: (failure) => feedback.failed(failure),
    }),
    [scope.organizationId, reading, route, feedback],
  );

  return <GithubHostProvider value={host}>{children}</GithubHostProvider>;
}
