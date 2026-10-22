import { isAggregateProjectKind } from "@langwatch/project-contract";
import { type ComponentType, useEffect } from "react";

import { useAnalyticsHost } from "../../model/analytics-host.ts";

/**
 * Renders an analytics screen on every project but an aggregate, for a screen whose subject is
 * kept inside one project (Topics). On an aggregate the address leads back to the Overview,
 * leaving no history entry, so the screen never mounts and none of its queries run (ADR-177 v4.15).
 */
export function withAggregateAnalyticsGate<P extends object>(
  Screen: ComponentType<P>,
): ComponentType<P> {
  function AggregateAnalyticsGate(props: P) {
    const host = useAnalyticsHost();
    const project = host.project();
    const aggregateSlug = project && isAggregateProjectKind(project.kind) ? project.slug : void 0;

    useEffect(() => {
      if (aggregateSlug) host.navigate(`/${aggregateSlug}/analytics`, { replace: true });
    }, [host, aggregateSlug]);

    if (aggregateSlug) return null;
    return <Screen {...props} />;
  }
  AggregateAnalyticsGate.displayName = `withAggregateAnalyticsGate(${Screen.displayName ?? Screen.name})`;
  return AggregateAnalyticsGate;
}
