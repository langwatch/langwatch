import {
  Box,
  Button,
  Heading,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { MeshGradient } from "@paper-design/shaders-react";
import { LuArrowRight, LuRocket } from "react-icons/lu";

import { Link } from "~/components/ui/link";
import { useReducedMotion } from "~/hooks/useReducedMotion";

import { useColorModeValue } from "../ui/color-mode";

// Amber → orange → violet palette so the governance hero visually rhymes with
// the home announcements (same MeshGradient + glass-card shape as
// `VoiceAgentsHomeBanner` / `TracesV2HomeBanner`) without reusing their teal.
const MESH_COLORS_LIGHT = ["#b45309", "#ea580c", "#7c3aed", "#fff7ed"];
const MESH_COLORS_DARK = ["#78350f", "#7c2d12", "#4c1d95", "#1a1206"];

/**
 * Admin empty-state hero for the AI tools portal. Shown when the org has
 * published no tools yet and the viewer can manage the catalog. Reuses the
 * home-banner glass-card visual to make "set up governance" feel like a
 * first-class call to action rather than a bare empty list, and points
 * straight at the tool catalog where the starter pack lives.
 *
 * Not dismissible: it disappears on its own the moment the first tool is
 * published (the portal switches to the tile grid).
 *
 * Spec: specs/ai-governance/personal-portal/portal-empty-state.feature
 */
export function GovernanceGettingStartedBanner() {
  const reduceMotion = useReducedMotion();
  const meshColors = useColorModeValue(MESH_COLORS_LIGHT, MESH_COLORS_DARK);

  return (
    <Box
      position="relative"
      width="full"
      borderRadius="xl"
      overflow="hidden"
      color="white"
      boxShadow="0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.18)"
      minHeight={{ base: "180px", md: "190px" }}
    >
      <Box position="absolute" inset={0} pointerEvents="none">
        <MeshGradient
          colors={meshColors}
          distortion={0.85}
          swirl={0.6}
          grainMixer={0.15}
          grainOverlay={0.18}
          speed={reduceMotion ? 0 : 0.45}
          scale={1.2}
          style={{ width: "100%", height: "100%" }}
        />
      </Box>
      <Box
        position="absolute"
        inset={0}
        pointerEvents="none"
        backgroundImage="linear-gradient(120deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.06) 55%, rgba(0,0,0,0) 100%)"
      />

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
          bg="white/20"
          boxShadow="inset 0 0 0 1px rgba(255,255,255,0.35)"
        >
          <Icon as={LuRocket} boxSize={5} color="white" />
        </Box>

        <VStack align="start" gap={1.5} flex={1} minWidth={0}>
          <Heading
            as="h2"
            size="md"
            color="white"
            letterSpacing="-0.01em"
            lineHeight={1.2}
          >
            Getting started with LangWatch AI Governance
          </Heading>
          <Text textStyle="sm" color="white/90" lineHeight={1.5}>
            Publish a curated catalog of AI tools so your team installs Claude
            Code, Codex, Gemini, and your model providers in one click, with
            virtual keys, spend controls, and usage visibility built in.
          </Text>
          <HStack gap={2} marginTop={1.5}>
            <Button
              asChild
              size="sm"
              bg="white"
              color="orange.700"
              fontWeight="600"
              paddingX={4}
              boxShadow="0 1px 2px rgba(0,0,0,0.12)"
              _hover={{ bg: "white/90", transform: "translateY(-1px)" }}
              _active={{ bg: "white/80", transform: "translateY(0)" }}
              transition="background-color 0.12s ease, transform 0.12s ease"
            >
              <Link href="/settings/governance/tool-catalog">
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
