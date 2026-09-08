/**
 * A small warning pinned to a widget card's corner, carrying the last error
 * the frame reported in a tooltip. Rendered by the host around the frame so
 * the frame's own layout (and its iframe) stays untouched.
 */

import { Box } from "@chakra-ui/react";
import { TriangleAlert } from "lucide-react";

import { Tooltip } from "~/components/ui/tooltip";

import type { ChartFrameLogEntry } from "./bridge/frameBridge";

export function FrameDiagnosticBadge({
  diagnostic,
}: {
  readonly diagnostic: ChartFrameLogEntry | null;
}) {
  if (!diagnostic) return null;
  return (
    <Tooltip
      content={`This widget reported a problem: ${diagnostic.text}`}
      showArrow
    >
      <Box
        position="absolute"
        top={1}
        right={1}
        color="orange.solid"
        aria-label="This widget reported a problem"
        role="img"
        data-testid="frame-diagnostic-badge"
        lineHeight={0}
      >
        <TriangleAlert size={14} />
      </Box>
    </Tooltip>
  );
}
