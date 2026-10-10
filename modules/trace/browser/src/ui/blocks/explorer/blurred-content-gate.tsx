import { Link } from "@langwatch/browser-host/link";
import { AccessState } from "@langwatch/design-system/access-state";
import { Box, Button } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

/** Covers redacted content beyond the plan's visibility window (ADR-028 §7). */
export function BlurredContentGate({ children }: { children?: ReactNode }) {
  return (
    <Box
      position={children ? "relative" : "absolute"}
      inset={children ? void 0 : 0}
      pointerEvents={children ? void 0 : "none"}
      zIndex={children ? void 0 : 10}
      data-testid="blurred-content-gate"
    >
      {children}
      <Box position="absolute" inset={0} pointerEvents="none" backdropFilter="blur(2px)" />
      <Box
        position="absolute"
        inset={0}
        display="flex"
        alignItems="center"
        justifyContent="center"
        padding={4}
        pointerEvents="none"
      >
        <Box maxWidth="440px" pointerEvents="auto">
          <AccessState
            kind="upgrade"
            compact
            title="Your data is still here"
            description="Your plan hides traces older than its visibility window. Compare plans for access to older traces."
            actions={
              <Button asChild size="sm" colorPalette="orange">
                <Link href="/settings/subscription">Compare plans</Link>
              </Button>
            }
          />
        </Box>
      </Box>
    </Box>
  );
}
