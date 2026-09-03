/**
 * What the Integrations screen is mounted inside: the tRPC Provider its
 * hooks run on, and the host port for organization, address, feedback and
 * departures. The organization is the session's active scope — no graph fetched for this page.
 */

import {
  GithubHostProvider,
  type GithubHostPort,
} from "@langwatch/github-web/screens/integrations";
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
