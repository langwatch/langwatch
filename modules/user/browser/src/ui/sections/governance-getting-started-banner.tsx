import { useColorRawValue } from "@langwatch/design-system/color-mode";
import {
  Box,
  Button,
  ClientOnly,
  Heading,
  HStack,
  Icon,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { useReducedMotion } from "@langwatch/design-system/use-reduced-motion";
import { MeshGradient } from "@paper-design/shaders-react";
import { LuArrowRight, LuRocket } from "react-icons/lu";

import { Link } from "../elements/personal-link.tsx";

// The canvas needs resolved colours after mount and whenever the mode changes.
function GovernanceMesh() {
  const reduceMotion = useReducedMotion();
  const amber = useColorRawValue("yellow.solid");
  const orange = useColorRawValue("orange.solid");
  const violet = useColorRawValue("purple.solid");
  const ground = useColorRawValue("bg.card");
  return (
    <MeshGradient
      colors={[amber, orange, violet, ground]}
      distortion={0.85}
      swirl={0.6}
      grainMixer={0.15}
      grainOverlay={0.18}
      speed={reduceMotion ? 0 : 0.45}
      scale={1.2}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

/**
 * Getting-started banner for AI tools portal (empty state).
 * Links to tool catalog; auto-dismisses when first tool is published.
 */
export function GovernanceGettingStartedBanner() {
  return (
    <Box
      position="relative"
      width="full"
      borderRadius="xl"
      overflow="hidden"
      color="fg"
      bg="bg.card"
      boxShadow="md"
      minHeight={{ base: "180px", md: "190px" }}
      // Center the content within the min-height so the hero keeps its
      // presence without pooling dead space below the button when the
      // copy is short.
      display="flex"
      alignItems="center"
    >
      <Box position="absolute" inset={0} pointerEvents="none" opacity={0.12}>
        <ClientOnly>
          <GovernanceMesh />
        </ClientOnly>
      </Box>

      <HStack
        position="relative"
        zIndex={1}
        align="center"
        gap={{ base: 4, md: 6 }}
        paddingLeft={{ base: 5, md: 7 }}
        paddingRight={{ base: 5, md: 7 }}
        paddingY={{ base: 6, md: 7 }}
        width="full"
      >
        <Box
          flexShrink={0}
          display="flex"
          alignItems="center"
          justifyContent="center"
          boxSize="44px"
          borderRadius="full"
          bg="bg.card"
          borderWidth="1px"
          borderColor="border.card"
        >
          <Icon as={LuRocket} boxSize={5} color="fg" />
        </Box>

        <VStack align="start" gap={1.5} flex={1} minWidth={0}>
          <Heading as="h2" size="md" color="fg" letterSpacing="-0.01em" lineHeight={1.2}>
            Getting started with LangWatch AI Governance
          </Heading>
          <Text textStyle="sm" color="fg.muted" lineHeight={1.5}>
            Publish a curated catalog of AI tools so your team installs Claude Code, Codex, Gemini,
            and your model providers in one click, with virtual keys, spend controls, and usage
            visibility built in.
          </Text>
          <HStack gap={2} marginTop={1.5}>
            <Button
              asChild
              size="sm"
              bg="bg.card"
              color="orange.fg"
              fontWeight="600"
              paddingX={4}
              boxShadow="sm"
              _hover={{ bg: "bg.nested", transform: "translateY(-1px)" }}
              _active={{ bg: "bg.control", transform: "translateY(0)" }}
              transition="background-color 0.12s ease, transform 0.12s ease"
            >
              <Link href="/governance/inventory?tab=catalog">
                Add your first tools
                <Icon as={LuArrowRight} boxSize={3.5} marginLeft={1} />
              </Link>
            </Button>
          </HStack>
        </VStack>
      </HStack>
    </Box>
  );
}
