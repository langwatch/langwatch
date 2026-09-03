/**
 * What every Ops screen is mounted inside: the tRPC Provider its hooks run
 * on, and the host port for operator access, project, address and feedback.
 * `ops:view`/`ops:manage` are deliberately decoupled — widening one can't widen the other.
 */

import { opsApi, OpsHostProvider, type OpsHostPort } from "@langwatch/ops-web/screens/ops";
import { useMemo, type ReactNode } from "react";
import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiAddress } from "../../../../behavior/ui-address";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";

/** The grant the Ops workspace is behind. */
export const OPS_VIEW_PERMISSION = "ops:view";

/** The strictly narrower grant the Backoffice is behind. */
export const OPS_MANAGE_PERMISSION = "ops:manage";

export function OpsHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const asPath = useUiAddress();

  const organizations = opsApi.organization.getAll.useQuery({ isDemo: false });

  /** The project the address is about, and the key it ingests with — resolved from the one graph read, `undefined` with none in scope. */
  const project = useMemo(() => {
    if (!scope.projectId) return void 0;
    for (const organization of organizations.data ?? []) {
      for (const team of organization.teams) {
        const found = team.projects.find((candidate) => candidate.id === scope.projectId);
        if (found) return { id: found.id, apiKey: found.apiKey };
      }
    }
    return void 0;
  }, [organizations.data, scope.projectId]);

  /**
   * Shared installs warn about a PRODUCT flag's fleet reach; a missing config
   * (a bare test mount) reads as self-hosted, which correctly stays quiet.
   */
  const sharedInstall = useMemo(() => {
    try {
      return readPublicAppConfig().deployment === "saas";
    } catch {
      return false;
    }
  }, []);

  const reading = route.reading();

  const host = useMemo<OpsHostPort>(
    () => ({
      // Fails closed: an answer that has not arrived reads as no.
      hasOpsAccess: () => session.hasPermission(OPS_VIEW_PERMISSION),
      isOpsAdmin: () => session.hasPermission(OPS_MANAGE_PERMISSION),
      sharedInstall: () => sharedInstall,
      project: () => project,
      route: () => reading,
      asPath: () => asPath,
      setQuery: (next, options) => route.setQuery(next, options),
      navigate: (to) => navigation.navigate(to),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [project, reading, asPath, sharedInstall, session, route, navigation, feedback],
  );

  return <OpsHostProvider value={host}>{children}</OpsHostProvider>;
}
