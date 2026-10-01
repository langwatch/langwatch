/** Workflow's clamped text, as workflow lends it (ARCHITECTURE.md §3.4, rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type { UiHoverableBigTextProps } from "@langwatch/browser-host/declarations";
import { Box, type BoxProps } from "@langwatch/design-system/primitives";
import { lazy, Suspense, useMemo } from "react";

/** The lent text in a box carrying this screen's type and width; plain text until it loads. */
export function HoverableBigText({
  children,
  lineClamp,
  expandedVersion,
  expandable,
  ...boxProps
}: UiHoverableBigTextProps & Omit<BoxProps, keyof UiHoverableBigTextProps>) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("hoverableBigText")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  const lentProps = { lineClamp, expandedVersion, expandable };
  return (
    <Box {...boxProps}>
      {lent.length === 0
        ? children
        : lent.map(({ key, Lent }) => (
            <Suspense key={key} fallback={children}>
              <Lent {...lentProps}>{children}</Lent>
            </Suspense>
          ))}
    </Box>
  );
}
