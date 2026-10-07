import { Alert } from "@chakra-ui/react";
import type { ComponentType } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Link } from "~/components/ui/link";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { isAggregateProjectKind } from "~/server/app-layer/projects/project-kinds";

/**
 * What an aggregate project (ADR-144) says where analytics would be: its
 * analytics do not read across members yet, and its traces do. The home's
 * traces overview and every analytics page share these words.
 */
export function AggregateAnalyticsMessage({
  projectSlug,
}: {
  projectSlug: string;
}) {
  return (
    <>
      Analytics across member projects is not available yet.{" "}
      <Link href={`/${projectSlug}/traces`} color="fg">
        Open Trace Explorer
      </Link>{" "}
      to see member traces.
    </>
  );
}

/**
 * The page an analytics URL renders on an aggregate project: the page's
 * heading and the notice, in place of a body whose charts would each say
 * "No data".
 */
function AggregateAnalyticsPage({
  title,
  projectSlug,
}: {
  title: string;
  projectSlug: string;
}) {
  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>{title}</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container>
        <Alert.Root status="info" size="sm" variant="subtle" width="full">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description fontSize="sm">
              <AggregateAnalyticsMessage projectSlug={projectSlug} />
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      </PageLayout.Container>
    </DashboardLayout>
  );
}

/**
 * Renders an analytics page on every project but an aggregate, which leaves
 * analytics until they read across its members. The navigation already hides
 * Analytics there; this catches a direct link or a bookmark. The page itself
 * never mounts on an aggregate, so none of its analytics queries run.
 */
export function withAggregateAnalyticsGate<P extends object>(
  title: string,
  Page: ComponentType<P>,
): ComponentType<P> {
  function AggregateAnalyticsGate(props: P) {
    const { project } = useOrganizationTeamProject();
    if (project && isAggregateProjectKind(project.kind)) {
      return (
        <AggregateAnalyticsPage title={title} projectSlug={project.slug} />
      );
    }
    return <Page {...props} />;
  }
  AggregateAnalyticsGate.displayName = `withAggregateAnalyticsGate(${
    Page.displayName ?? Page.name
  })`;
  return AggregateAnalyticsGate;
}
