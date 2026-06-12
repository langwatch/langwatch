import { Box, Button, Text, VStack } from "@chakra-ui/react";
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
export const BlurredContentGate = memo(function BlurredContentGate({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Box position="relative" data-testid="blurred-content-gate">
      {children}
      {/* Progressive backdrop blur over the container: top stays readable,
          bottom dissolves. Masked so the blur ramps instead of cutting. */}
      <Box
        position="absolute"
        inset={0}
        pointerEvents="none"
        backdropFilter="blur(3px)"
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent 0%, transparent 18%, black 45%, black 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, transparent 18%, black 45%, black 100%)",
        }}
      />
      <Box
        position="absolute"
        inset={0}
        pointerEvents="none"
        backdropFilter="blur(7px)"
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent 0%, transparent 45%, black 75%, black 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, transparent 45%, black 75%, black 100%)",
        }}
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
            <Lock size={13} /> Your data is still here
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
