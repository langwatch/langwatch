import { PageLayout } from "@langwatch/design-system/page-layout";
import { Alert } from "@langwatch/design-system/primitives";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import type { ComponentType } from "react";

import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { Link } from "../elements/analytics-link.tsx";

/**
 * The page an analytics address renders on an aggregate project (ADR-177): the heading and a
 * notice pointing at the Trace Explorer, in place of a body whose charts would each say "No data".
 */
function AggregateAnalyticsPage({ title, projectSlug }: { title: string; projectSlug: string }) {
  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>{title}</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container>
        <Alert.Root status="info" size="sm" variant="subtle" width="full">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description fontSize="sm">
              Analytics across member projects is not available yet.{" "}
              <Link href={`/${projectSlug}/traces`} color="fg">
                Open Trace Explorer
              </Link>{" "}
              to see member traces.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      </PageLayout.Container>
    </>
  );
}

/**
 * Renders an analytics screen on every project but an aggregate, whose analytics do not read
 * across members yet. The screen never mounts there, so none of its queries run.
 */
export function withAggregateAnalyticsGate<P extends object>(
  title: string,
  Screen: ComponentType<P>,
): ComponentType<P> {
  function AggregateAnalyticsGate(props: P) {
    const project = useAnalyticsHost().project();
    if (project && isAggregateProjectKind(project.kind)) {
      return <AggregateAnalyticsPage title={title} projectSlug={project.slug} />;
    }
    return <Screen {...props} />;
  }
  AggregateAnalyticsGate.displayName = `withAggregateAnalyticsGate(${Screen.displayName ?? Screen.name})`;
  return AggregateAnalyticsGate;
}
