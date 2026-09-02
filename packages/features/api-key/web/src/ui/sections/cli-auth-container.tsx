/**
 * The full-page frame the CLI authorize screen renders inside.
 *
 * A NARROWED FAMILY-LOCAL COPY of
 * `platform/app/src/features/onboarding/components/containers/OnboardingContainer.tsx`,
 * which stays for the onboarding family that owns it. `/cli/auth` is not a
 * settings page — it is the page a browser opened by `langwatch login` lands on,
 * with no shell around it — so it frames itself, and the settings chrome every
 * other family in this move uses would be wrong here.
 *
 * WHAT DID NOT TRAVEL, and why each is a deletion rather than a loss:
 *
 *   - **The sign-out button.** It reached `signOut` from the session client and
 *     `useAnalytics` to emit its click, neither of which a screen may name. It is
 *     also the one control on the frame that has nothing to do with approving a
 *     device code: a reader who signs out mid-approval loses the flow. Recorded
 *     as the one visible difference on this page.
 *   - **The back button, the skip link, `widthVariant` and `compressedHeader`.**
 *     `/cli/auth` passes none of them — `showBackButton={false}` explicitly — so
 *     they are dead props here, and carrying them would drag `~/components/ui/link`
 *     and its router with them.
 *
 * The mesh background, the logo, the entrance animation and the loading skeleton
 * all travel, because they are what the page looks like.
 */

import {
  Box,
  Center,
  Container,
  HStack,
  Skeleton,
  SkeletonText,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { FullLogo } from "../elements/full-logo";

const MotionBox = motion.create(Box);
const MotionText = motion.create(Text);

/** The soft orange wash behind the card. */
function CliAuthMeshBackground(): React.ReactElement {
  return (
    <Box
      position="absolute"
      inset={0}
      pointerEvents="none"
      overflow="hidden"
      zIndex={0}
      style={{
        contain: "layout paint",
        background: [
          "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(237,137,38,0.06) 0%, transparent 70%)",
          "radial-gradient(ellipse 60% 40% at 70% 100%, rgba(237,137,38,0.02) 0%, transparent 60%)",
        ].join(", "),
      }}
    />
  );
}

/** What the card shows while the session answer is still arriving. */
function CliAuthSkeleton(): React.ReactElement {
  return (
    <VStack gap={6} align="stretch">
      <VStack gap={2} align="stretch">
        <Skeleton loading h="40px" borderRadius="lg" variant="shine" />
        <SkeletonText loading noOfLines={1} gap={2} variant="shine" />
        <HStack gap={3} align="center">
          <Skeleton loading boxSize="20px" borderRadius="xs" variant="shine" />
          <SkeletonText loading noOfLines={1} w="65%" variant="shine" />
        </HStack>
      </VStack>
      <HStack justify="space-between" w="full">
        <Box />
        <HStack gap={3}>
          <Skeleton loading h="40px" w="80px" borderRadius="lg" variant="shine" />
        </HStack>
      </HStack>
    </VStack>
  );
}

export function CliAuthContainer({
  children,
  title,
  subTitle,
  loading,
}: React.PropsWithChildren<{
  title: string;
  subTitle?: string;
  loading?: boolean;
}>): React.ReactElement {
  return (
    // "stable both-edges" keeps the reserved scrollbar gutter symmetric so
    // the card column stays visually centered even with always-visible
    // scrollbars (one-edge "stable" shifted everything left).
    <Box
      w="full"
      minH="100dvh"
      bg="bg.page"
      position="relative"
      style={{ scrollbarGutter: "stable both-edges" }}
      overflowY="auto"
    >
      <CliAuthMeshBackground />

      <Container
        width="full"
        mx="auto"
        pt="14vh"
        pb={16}
        maxW={{ base: "100%", md: "540px" }}
        px={{ base: 4, md: 0 }}
      >
        <MotionBox
          bg="bg.panel"
          borderRadius="16px"
          border="1px solid"
          borderColor="border.subtle"
          boxShadow="sm"
          px={{ base: 5, md: 7 }}
          py={{ base: 6, md: 8 }}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        >
          <VStack gap={6} align="stretch" w="full">
            <Center pt={1}>
              <FullLogo width={130} />
            </Center>
            <VStack gap={1.5} align="center" textAlign="center" w="full">
              <AnimatePresence mode="wait">
                <MotionText
                  key={title}
                  textStyle="xl"
                  fontWeight="600"
                  color="fg"
                  letterSpacing="-0.01em"
                  lineHeight="1.3"
                  initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  {title}
                </MotionText>
              </AnimatePresence>
              <AnimatePresence mode="wait">
                {subTitle && (
                  <MotionText
                    key={subTitle}
                    textStyle="sm"
                    color="fg.muted"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                  >
                    {subTitle}
                  </MotionText>
                )}
              </AnimatePresence>
            </VStack>
            {loading ? <CliAuthSkeleton /> : children}
          </VStack>
        </MotionBox>
      </Container>
    </Box>
  );
}
