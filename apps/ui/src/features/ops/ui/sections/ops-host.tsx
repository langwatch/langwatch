/**
 * What every Ops screen is mounted inside.
 *
 * Two things go around every `/ops/*` page: the tRPC Provider the package's own
 * hooks run on, and the host port that answers for operator access, the project
 * the reader is standing in, the address and the feedback. Both are mounted
 * here, once, so a screen module stays a screen module.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product want
 * it. This family reads the PROJECT's API key off it, because the Foundry sends
 * a generated trace with the key of the project the operator is standing in.
 *
 * THE TWO ACCESS ANSWERS ARE SESSION GRANTS, and that is the whole of the admin
 * gate. `platform/app` asked a live `ops.getScope` probe for the workspace and a
 * separate `user.isAdmin` read for the Backoffice, deliberately decoupled so
 * that widening one could never widen the other. Both facts are already in the
 * session capability as platform-tier permissions — `ops:view` reads,
 * `ops:manage` writes — so a reader with `ops:view` and no `ops:manage` sees the
 * workspace and is refused the Backoffice.
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

  /**
   * The project the address is about, and the key it ingests with.
   *
   * Resolved from the one graph read rather than from a second query, and only
   * when there IS a project in scope: an operator on `/ops` with no project
   * selected gets `undefined`, which is what the Foundry's picker already
   * handles.
   */
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
