/**
 * What every Ops screen is mounted inside.
 *
 * Two things go around every `/ops/*` page: the tRPC Provider the package's own
 * hooks run on, and the host port that answers for operator access, the project
 * the reader is standing in, the address and the feedback. Both are mounted
 * here, once, so a screen module stays a screen module.
 *
 * The reads live here rather than in the adapter for a reason worth keeping: the
 * adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product want
 * it. This family reads the PROJECT's API key off it, because the Foundry sends
 * a generated trace with the key of the project the operator is standing in.
 */

import { opsApi, OpsHostProvider } from "@langwatch/ops-web/screens/ops";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiAddress } from "../../../../behavior/ui-address";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { UiOpsHost } from "../../behavior/ops-host.adapter";

function OpsHost({ children }: { children: ReactNode }) {
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
  const host = useMemo(
    () =>
      UiOpsHost.create(
        { project, route: reading, asPath, sharedInstall },
        {
          hasPermission: (permission) => session.hasPermission(permission),
          setQuery: (next, options) => route.setQuery(next, options),
          navigate: (to) => navigation.navigate(to),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [project, reading, asPath, sharedInstall, session, route, navigation, feedback],
  );

  return <OpsHostProvider value={host}>{children}</OpsHostProvider>;
}

/** Wraps an Ops screen in the host its package asks for. */
export function withOpsHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <OpsHost>
      <Screen {...props} />
    </OpsHost>
  );
  Mounted.displayName = `withOpsHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
