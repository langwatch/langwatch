import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { Lock } from "lucide-react";
import { memo } from "react";
import type { ReactNode } from "react";

import { Link } from "~/components/ui/link";

/**
 * Upgrade treatment for visibility-window-redacted content (ADR-028 §7).
 *
 * Wraps a tab's content section: the real (server-teased, "…"-terminated)
 * content renders normally and stays readable near the top, while a
 * progressive backdrop blur — light at the top, maximal at the bottom —
 * dissolves the rest of the container, with the upgrade card centered over
 * it. No fabricated text: the ellipsis already ships in the API payload, so
 * every surface (UI, SDK, exports) sees the same truncation marker.
 */
// Same rainbow recipe as ShikiCommandBox (PostHog's rainbow-scroll):
// 5-stop gradient, background-clip: text, 3s background-position sweep.
const lwRainbowScroll = keyframes`
  0% { background-position-x: 0%; }
  100% { background-position-x: 200%; }
`;

const RAINBOW_GRADIENT =
  "linear-gradient(90deg, #0143cb 0%, #2b6ff4 24%, #d23401 47%, #ff651f 66%, #fba000 83%, #0143cb 100%)";

// The lock is an SVG stroke — background-clip can't paint it, so cycle its
// color through the same palette, synced to the text sweep's 3s period.
const lwRainbowStroke = keyframes`
  0% { color: #0143cb; }
  24% { color: #2b6ff4; }
  47% { color: #d23401; }
  66% { color: #ff651f; }
  83% { color: #fba000; }
  100% { color: #0143cb; }
`;

export const BlurredContentGate = memo(function BlurredContentGate({
  children,
}: {
  /**
   * When provided, wraps the content in a relative box. When omitted, the
   * gate renders as a pure absolute overlay — drop it as the LAST child of
   * a `position: relative` container (e.g. the trace drawer's content
   * pane) so one layer covers every tab.
   */
  children?: ReactNode;
}) {
  return (
    <Box
      position={children ? "relative" : "absolute"}
      inset={children ? undefined : 0}
      pointerEvents={children ? undefined : "none"}
      zIndex={children ? undefined : 10}
      data-testid="blurred-content-gate"
    >
      {children}
      {/* Progressive backdrop blur over the container: top stays readable,
          bottom dissolves. Masked so the blur ramps instead of cutting. */}
      {/* Uniform blur over the whole gated container. */}
      <Box
        position="absolute"
        inset={0}
        pointerEvents="none"
        backdropFilter="blur(2px)"
      />
      {/* Soft wash so the deepest section reads as locked, not broken. */}
      <Box
        position="absolute"
        inset={0}
        pointerEvents="none"
        bgGradient="to-b"
        gradientFrom="transparent"
        gradientVia="transparent"
        gradientTo="bg.muted/60"
      />
      <Box
        position="absolute"
        inset={0}
        display="flex"
        alignItems="center"
        justifyContent="center"
        pointerEvents="none"
      >
        <VStack
          gap={1}
          paddingX={5}
          paddingY={3}
          borderRadius="lg"
          borderWidth="1px"
          backgroundColor="bg.panel"
          boxShadow="lg"
          pointerEvents="auto"
        >
          <Text
            fontSize="sm"
            fontWeight="semibold"
            display="flex"
            alignItems="center"
            gap={1.5}
          >
            <Box
              as="span"
              display="inline-flex"
              css={{
                animation: `${lwRainbowStroke} 3s linear infinite`,
                "@media (prefers-reduced-motion: reduce)": {
                  animation: "none",
                  color: "#2b6ff4",
                },
              }}
            >
              <Lock size={13} />
            </Box>
            <Box
              as="span"
              css={{
                backgroundImage: RAINBOW_GRADIENT,
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                color: "transparent",
                WebkitTextFillColor: "transparent",
                backgroundSize: "200% 100%",
                animation: `${lwRainbowScroll} 3s linear infinite`,
                "@media (prefers-reduced-motion: reduce)": {
                  animation: "none",
                },
              }}
            >
              Your data is still here
            </Box>
          </Text>
          <Text fontSize="xs" color="fg.muted" textAlign="center">
            Traces older than your plan&apos;s visibility window are hidden.
          </Text>
          <Link href="/settings/subscription">
            <Button size="2xs" colorPalette="orange" marginTop={1}>
              Upgrade to unlock
            </Button>
          </Link>
        </VStack>
      </Box>
    </Box>
  );
});
