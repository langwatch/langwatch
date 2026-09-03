/**
 * What the Datasets screens are mounted inside.
 *
 * Two things go around `/:project/datasets` and `/:project/datasets/:id`: the
 * tRPC Provider the package's own hooks run on, and the host port that answers
 * for the project, the reader's grants and membership, the replication targets,
 * the address and the feedback. Both are mounted here, once, so a screen module
 * stays a screen module.
 *
 * The reads live here rather than in the adapter for a reason worth keeping: the
 * adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product want
 * it. This family reads the whole graph rather than one project, because the
 * replication picker offers every project the reader may create a dataset in.
 *
 * THE UNDO IS RENDERED HERE, on the toaster's own action trigger. The feedback
 * capability carries a title and a description and no action, and widening it is
 * a change to a shared port that a page move does not own; the platform page put
 * an Undo button inside the toast, and a toast action is the same affordance
 * without the JSX. Everything else — every failure, and every success without an
 * undo — goes through the capability, so the code-keyed copy still decides the
 * words a customer reads.
 */

import {
  datasetApi,
  DatasetHostProvider,
  type DatasetSuccessNotice,
} from "@langwatch/dataset-web/screens/datasets";
import { toaster } from "@langwatch/design-system/toaster";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";
import { UiDatasetHost } from "../../behavior/dataset-host.adapter";
import { datasetCopyTargets } from "../../model/dataset-copy-targets";

function DatasetHost({ children }: { children: ReactNode }) {
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
  const host = useMemo(
    () =>
      UiDatasetHost.create(
        {
          project,
          hasPermission: (permission: string) => session.hasPermission(permission),
          isLiteMember,
          copyTargets,
          route: reading,
        },
        {
          setQuery: (next, options) => route.setQuery(next, options),
          navigate: (to) => navigation.navigate(to),
          succeeded: (notice: DatasetSuccessNotice) => {
            if (!notice.undo) {
              feedback.succeeded(notice);
              return;
            }
            toaster.create({
              ...(notice.id ? { id: notice.id } : {}),
              title: notice.title,
              ...(notice.description ? { description: notice.description } : {}),
              type: "success",
              ...(notice.durationMs ? { duration: notice.durationMs } : {}),
              action: { label: notice.undo.label, onClick: notice.undo.perform },
            });
          },
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [project, session, isLiteMember, copyTargets, reading, route, navigation, feedback],
  );

  return <DatasetHostProvider value={host}>{children}</DatasetHostProvider>;
}

/** Wraps a Datasets screen in the host its package asks for. */
export function withDatasetHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <DatasetHost>
      <Screen {...props} />
    </DatasetHost>
  );
  Mounted.displayName = `withDatasetHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
