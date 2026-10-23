/**
 * The analytics surface's saved views: one provider for the page and the strip pinned to the
 * bottom of the scrolling card. Every analytics screen renders inside it. An aggregate keeps no
 * views of its own (ADR-177), so it reads none and shows no strip.
 */

import { Box } from "@langwatch/design-system/primitives";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import type { ReactNode } from "react";

import { SavedViewsProvider } from "../../behavior/use-saved-views.tsx";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { SavedViewsBar } from "./saved-views-bar.tsx";

export function SavedViewsScope({ children }: { children: ReactNode }) {
  const isAggregate = isAggregateProjectKind(useAnalyticsHost().project()?.kind);
  if (isAggregate) {
    return (
      <Box width="full" flex="1" minHeight={0} display="flex" flexDirection="column">
        {children}
      </Box>
    );
  }
  return (
    <SavedViewsProvider>
      <Box width="full" flex="1" minHeight={0} display="flex" flexDirection="column">
        {children}
        <SavedViewsBar />
      </Box>
    </SavedViewsProvider>
  );
}
