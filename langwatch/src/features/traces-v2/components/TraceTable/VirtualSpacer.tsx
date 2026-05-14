import type React from "react";
import { Tbody } from "./TablePrimitives";

interface VirtualSpacerProps {
  height: number;
  colSpan: number;
}

/**
 * Empty <tbody> row used by the virtualizer to take up the offset above and
 * below the visible window. Multiple <tbody> elements per <table> are valid HTML.
 */
export const VirtualSpacer: React.FC<VirtualSpacerProps> = ({
  height,
  colSpan,
}) => {
  if (height <= 0) return null;
  return (
    <Tbody aria-hidden="true">
      <tr>
        <td colSpan={colSpan} style={{ height: `${height}px`, padding: 0 }} />
      </tr>
    </Tbody>
  );
};
