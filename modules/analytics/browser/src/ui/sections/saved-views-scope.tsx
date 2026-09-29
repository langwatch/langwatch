/**
 * The analytics surface's saved views: one provider for the page and the strip pinned to the
 * bottom of the scrolling card. Every analytics screen renders inside it.
 */

import { Box } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { SavedViewsBar } from "./saved-views-bar.tsx";
import { SavedViewsProvider } from "./use-saved-views.tsx";

export function SavedViewsScope({ children }: { children: ReactNode }) {
  return (
    <SavedViewsProvider>
      <Box width="full" flexShrink={0} display="flex" flexDirection="column">
        {children}
        <SavedViewsBar />
      </Box>
    </SavedViewsProvider>
  );
}
