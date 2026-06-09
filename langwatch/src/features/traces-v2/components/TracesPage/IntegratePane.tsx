/**
 * IntegratePane — the default view for no-traces projects.
 *
 * Shown when `hasAnyTraces === false` and the user hasn't flipped on
 * "See sample data". A full-height hero that makes integrating the
 * primary call to action, with "See sample data" as a secondary escape
 * to preview the product without committing.
 */
import {
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useState } from "react";
import { Cable, Compass } from "lucide-react";
import { OnboardingMeshBackground } from "~/features/onboarding/components/OnboardingMeshBackground";
import { useOnboardingStore } from "../../onboarding/store/onboardingStore";
import { IntegrateDrawer } from "../../onboarding/components/IntegrateDrawer";
import { Toolbar } from "../Toolbar/Toolbar";

export const IntegratePane: React.FC = () => {
  const setShowSamplePreview = useOnboardingStore(
    (s) => s.setShowSamplePreview,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <Flex
      as="main"
      role="main"
      aria-label="Integrate your code"
      direction="column"
      flex={1}
      minWidth={0}
      height="full"
      position="relative"
    >
      <Toolbar />
      {/* Mesh background fills the pane so the hero sits on the
          warm gradient canvas rather than a flat surface. */}
      <Box flex={1} position="relative" overflow="hidden">
        <OnboardingMeshBackground />
        <AnimatePresence>
          <motion.div
            key="integrate-hero"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            style={{ position: "absolute", inset: 0, display: "flex" }}
          >
            <Flex
              position="absolute"
              inset={0}
              align="center"
              justify="center"
              paddingX={6}
            >
              <VStack
                gap={6}
                maxWidth="480px"
                width="full"
                align="center"
                textAlign="center"
              >
                <Box
                  padding={4}
                  borderRadius="xl"
                  bg="orange.subtle"
                  borderWidth="1px"
                  borderColor="orange.muted"
                >
                  <Icon as={Cable} boxSize={7} color="orange.fg" />
                </Box>

                <VStack gap={2} align="center">
                  <Text
                    textStyle="2xl"
                    fontWeight="600"
                    color="fg"
                    lineHeight="tight"
                  >
                    Connect your first traces
                  </Text>
                  <Text
                    textStyle="sm"
                    color="fg.muted"
                    lineHeight="tall"
                    maxWidth="360px"
                  >
                    Send your first trace in under two minutes via a coding
                    agent skill, MCP server, or the LangWatch SDK.
                  </Text>
                </VStack>

                <HStack gap={3}>
                  <Button
                    size="md"
                    colorPalette="orange"
                    variant="solid"
                    onClick={() => setDrawerOpen(true)}
                  >
                    <Icon as={Cable} boxSize={4} />
                    Integrate my code
                  </Button>
                  <Button
                    size="md"
                    variant="ghost"
                    color="fg.muted"
                    onClick={() => setShowSamplePreview(true)}
                  >
                    <Icon as={Compass} boxSize={4} />
                    See sample data first
                  </Button>
                </HStack>
              </VStack>
            </Flex>
          </motion.div>
        </AnimatePresence>
      </Box>

      <IntegrateDrawer
        open={drawerOpen}
        onOpenChange={(open) => setDrawerOpen(open)}
      />
    </Flex>
  );
};
