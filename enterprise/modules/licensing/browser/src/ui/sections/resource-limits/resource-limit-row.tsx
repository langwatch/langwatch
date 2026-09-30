import { Text } from "@chakra-ui/react";
import { StatTile, StatTileFigure } from "@langwatch/design-system/stat-tile";

import { formatLimitOrUnlimited } from "../../../model/license-status.ts";

export interface ResourceLimitRowProps {
  label: string;
  current: number;
  max?: number;
}

/** Usage against a limit as a tile: the figure, and a meter when the limit is a real number. */
export function ResourceLimitRow({ label, current, max }: ResourceLimitRowProps) {
  const isMetered = max !== void 0 && Number.isFinite(max) && max < 1_000_000;
  return (
    <StatTile label={label} meter={isMetered ? { current, max } : void 0}>
      <StatTileFigure>
        {current.toLocaleString()}
        {max != null && (
          <Text as="span" fontSize="sm" fontWeight="normal" color="fg.muted">
            {" "}
            / {formatLimitOrUnlimited(max)}
          </Text>
        )}
      </StatTileFigure>
    </StatTile>
  );
}
