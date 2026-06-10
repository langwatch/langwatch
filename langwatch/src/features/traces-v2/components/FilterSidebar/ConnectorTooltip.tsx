import { Box } from "@chakra-ui/react";
import type React from "react";
import type { OrGroup } from "~/server/app-layer/traces/query-language/queries";
import { orGroupColor } from "./orGroupPalette";

const TOOLTIP_WIDTH = 240;

interface ConnectorTooltipProps {
  group: OrGroup;
  pos: { x: number; y: number };
}

/**
 * Floating tooltip that appears when the user hovers a connector
 * line. Lists the group's members in the same colour as the line +
 * pill so the user can confirm which clauses are linked by OR. Pulled
 * out of `OrConnectorOverlay` so the overlay file owns just the line
 * geometry; the tooltip is its own concern.
 *
 * Anchored just to the right of the cursor — the connector line
 * lives on the sidebar's right edge so there's always space in the
 * adjacent results pane. Clamps against the viewport edges so a
 * bottom-near-edge hover doesn't push the body offscreen.
 */
export const ConnectorTooltip: React.FC<ConnectorTooltipProps> = ({
  group,
  pos,
}) => {
  const palette = orGroupColor(group.id);
  const top = Math.min(window.innerHeight - 80, Math.max(8, pos.y + 8));
  const left = Math.min(window.innerWidth - TOOLTIP_WIDTH - 8, pos.x + 12);
  return (
    <Box
      position="fixed"
      top={`${top}px`}
      left={`${left}px`}
      width={`${TOOLTIP_WIDTH}px`}
      maxWidth={`${TOOLTIP_WIDTH}px`}
      bg="bg.panel"
      borderWidth="1px"
      borderColor={`${palette}.muted`}
      borderRadius="md"
      paddingX={2.5}
      paddingY={1.5}
      boxShadow="md"
      pointerEvents="none"
      zIndex={2100}
    >
      <Box
        fontSize="2xs"
        color="fg.muted"
        fontWeight="600"
        letterSpacing="0.04em"
        textTransform="uppercase"
        mb={1}
      >
        Linked by OR
      </Box>
      <Box fontSize="xs" lineHeight="1.5">
        {group.members.map((m, i) => (
          <Box key={i}>
            {m.negated && (
              <Box as="span" color={`${palette}.fg`} fontWeight="600">
                NOT&nbsp;
              </Box>
            )}
            <Box as="span" color="fg.muted">
              {m.field}:
            </Box>
            <Box as="span" color="fg" fontWeight="500">
              {m.value}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
