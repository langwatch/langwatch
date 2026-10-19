/**
 * The frame every `/gateway/*` page renders inside: no padding, no width, no
 * rail. The shell owns the chrome and each screen sets its own Header and Container.
 */

import { Box } from "@langwatch/design-system/primitives";
import { type PropsWithChildren, useEffect } from "react";

export default function AiGatewayLayout({
  children,
  pageTitle,
}: PropsWithChildren<{ pageTitle?: string }>) {
  useEffect(() => {
    if (pageTitle === void 0) return;
    // Queued so it lands after the shell's own title effect.
    queueMicrotask(() => {
      document.title = pageTitle;
    });
  }, [pageTitle]);

  return (
    <Box width="full" data-testid="section-navigation-layout">
      {children}
    </Box>
  );
}
