/**
 * What the Datasets screens are mounted inside: the tRPC Provider their
 * hooks run on, and the host port for project, grants/membership,
 * replication targets, address and feedback.
 */

import {
  datasetApi,
  DatasetHostProvider,
  type DatasetHostPort,
} from "@langwatch/dataset-web/screens/datasets";
import { toaster } from "@langwatch/design-system/toaster";
import { useMemo, type ReactNode } from "react";
import { useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";
import { useUiShellFailure } from "../../../../behavior/ui-shell-failure";
import { UiPageFailure, UiPageLoading } from "../../../../ui/sections/ui-page-fallbacks";
import { notifyDatasetSuccess } from "../../behavior/dataset-success-notice";
import { datasetCopyTargets } from "../../model/dataset-copy-targets";

export function DatasetHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const { isLiteMember } = useUiOrganizationFacts();

  const organizations = datasetApi.organization.getAll.useQuery({ isDemo: false });

  // A refused graph is a state, not an empty one: `project` below is read
  // off this query, so a refusal left the datasets screen empty forever.
  const failure = useUiShellFailure({
    error: organizations.error,
    fallbackTitle: "Couldn't load your datasets",
  });

  /** The project the address is about, resolved from the one graph read rather than a second query. */
  const project = useMemo(() => {
    if (!scope.projectId) return void 0;
    for (const organization of organizations.data ?? []) {
      for (const team of organization.teams) {
        const found = team.projects.find((candidate) => candidate.id === scope.projectId);
        if (found) return { id: found.id, slug: found.slug, name: found.name };
      }
    }
    return void 0;
  }, [organizations.data, scope.projectId]);

  const copyTargets = useMemo(
    () =>
      datasetCopyTargets({
        organizations: organizations.data ?? [],
        userId: session.currentUser()?.id,
      }),
    [organizations.data, session],
  );

  const reading = route.reading();
  const host = useMemo<DatasetHostPort>(
    () => ({
      project: () => project,
      hasPermission: (permission) => session.hasPermission(permission),
      isLiteMember: () => isLiteMember,
      copyTargets: () => copyTargets,
      route: () => reading,
      setQuery: (next, options) => route.setQuery(next, options),
      navigate: (to) => navigation.navigate(to),
      succeeded: (notice) =>
        notifyDatasetSuccess({
          notice,
          succeeded: (notice) => feedback.succeeded(notice),
          createToast: (toast) => toaster.create(toast),
        }),
      failed: (failure) => feedback.failed(failure),
      // Recorded gap, not a carried behaviour: the dedup interceptors this
      // answers for live on platform/app's own MutationCache, not here.
      isReportedGlobally: () => false,
    }),
    [project, session, isLiteMember, copyTargets, reading, route, navigation, feedback],
  );

  if (failure.departing) return <UiPageLoading />;
  if (failure.copy) return <UiPageFailure copy={failure.copy} />;

  return <DatasetHostProvider value={host}>{children}</DatasetHostProvider>;
}
