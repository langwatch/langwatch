/**
 * What the Datasets screens are mounted inside.
 *
 * Two things go around `/:project/datasets` and `/:project/datasets/:id`: the
 * tRPC Provider the package's own hooks run on, and the host port that answers
 * for the project, the reader's grants and membership, the replication targets,
 * the address and the feedback. Both are mounted here, once, so a screen module
 * stays a screen module.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product want
 * it. This family reads the whole graph rather than one project, because the
 * replication picker offers every project the reader may create a dataset in.
 *
 * `isReportedGlobally` is a recorded gap rather than a carried behaviour, and
 * the honest answer here is `false`. `platform/app` deduped a refusal one of
 * its four global interceptors already rendered against, and those
 * interceptors live on `platform/app`'s own MutationCache, which does not wrap
 * the client this application builds for a package's hooks. It closes when the
 * global interceptors move to the transport rather than to one application's
 * cache.
 */

import {
  datasetApi,
  DatasetHostProvider,
  type DatasetHostPort,
} from "@langwatch/dataset-web/screens/datasets";
import { toaster } from "@langwatch/design-system/toaster";
import { useMemo, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";
import { notifyDatasetSuccess } from "../../behavior/dataset-success-notice";
import { datasetCopyTargets } from "../../model/dataset-copy-targets";

export function DatasetHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const { isLiteMember } = useUiOrganizationFacts();

  const organizations = datasetApi.organization.getAll.useQuery({ isDemo: false });

  /**
   * The project the address is about.
   *
   * Resolved from the one graph read rather than from a second query. Without a
   * project in scope the screens render their empty shells, which is what they
   * did before: every dataset belongs to a project.
   */
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
          succeeded: feedback.succeeded,
          createToast: (toast) => toaster.create(toast),
        }),
      failed: (failure) => feedback.failed(failure),
      isReportedGlobally: () => false,
    }),
    [project, session, isLiteMember, copyTargets, reading, route, navigation, feedback],
  );

  return <DatasetHostProvider value={host}>{children}</DatasetHostProvider>;
}
