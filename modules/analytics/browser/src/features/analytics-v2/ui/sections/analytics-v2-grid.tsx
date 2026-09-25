/**
 * The nine Analytics v2 charts, one card each, on a responsive two-column grid.
 * Each card renders its inline definition through the shared DashboardWidgetFrame
 * behind its own error boundary, so one widget that throws stays contained.
 */

import { Card, Heading, SimpleGrid, Text } from "@chakra-ui/react";
import { ErrorBoundary } from "react-error-boundary";

import { DashboardWidgetFrame } from "../../../../ui/sections/dashboard-widget-frame.tsx";
import { ANALYTICS_V2_WIDGETS } from "../../model/analytics-v2-widgets.ts";

/** Height each widget frame renders at, in pixels. */
const WIDGET_MAX_HEIGHT = 320;

export interface AnalyticsV2GridProps {
  readonly projectId: string;
  readonly projectSlug: string;
}

export function AnalyticsV2Grid({ projectId, projectSlug }: AnalyticsV2GridProps) {
  return (
    <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} width="full">
      {ANALYTICS_V2_WIDGETS.map((widget) => (
        <Card.Root key={widget.id} data-testid={`analytics-v2-widget-${widget.id}`}>
          <Card.Header paddingBottom={2}>
            <Heading size="sm">{widget.title}</Heading>
          </Card.Header>
          <Card.Body paddingTop={0}>
            <ErrorBoundary
              fallback={
                <Text fontSize="13px" color="fg.muted" role="alert">
                  This chart could not be rendered.
                </Text>
              }
            >
              <DashboardWidgetFrame
                id={widget.id}
                graph={widget.definition}
                projectId={projectId}
                projectSlug={projectSlug}
                widgetName={widget.title}
                maxHeight={WIDGET_MAX_HEIGHT}
              />
            </ErrorBoundary>
          </Card.Body>
        </Card.Root>
      ))}
    </SimpleGrid>
  );
}
