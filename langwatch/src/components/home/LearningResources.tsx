import {
  Box,
  Link as ChakraLink,
  Grid,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { MeshGradient } from "@paper-design/shaders-react";
import { LuBookOpen, LuCirclePlay, LuExternalLink } from "react-icons/lu";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { Link } from "../ui/link";

interface MeshConfig {
  /** Mesh palette. */
  colors: string[];
  /** How much the mesh deforms — higher = more organic blobs. */
  distortion: number;
  /** Rotational twist around the centre. */
  swirl: number;
  /** Animation speed (0 disables motion when reducedMotion is on). */
  speed: number;
  /** Mesh scale — bigger = larger, lazier patches. */
  scale: number;
  /** Film-grain noise blended into the colour. */
  grainMixer: number;
  /** Film-grain noise overlaid as luminance. */
  grainOverlay: number;
  /** Initial mesh offset so the two cards don't share a frame phase. */
  offsetX: number;
  offsetY: number;
}

type ResourceCard = {
  title: string;
  description: string;
  icon: React.ReactNode;
  mesh: MeshConfig;
  href: string;
  cta: string;
};

const resources: ResourceCard[] = [
  {
    title: "Documentation",
    description: "Learn how to integrate and use LangWatch effectively",
    icon: <LuBookOpen size={18} />,
    // Documentation: cool, calm, almost-still. Huge soft blobs that
    // barely move — reads like wide ocean horizons. Distortion floored,
    // no swirl, slow speed, anchored at origin.
    mesh: {
      colors: ["#0c1c3d", "#1e3a8a", "#2563eb", "#06b6d4", "#22d3ee"],
      distortion: 0.05,
      swirl: 0.0,
      speed: 0.08,
      scale: 2.4,
      grainMixer: 0.02,
      grainOverlay: 0.03,
      offsetX: -0.2,
      offsetY: 0.15,
    },
    href: "https://docs.langwatch.ai",
    cta: "View documentation",
  },
  {
    title: "Video Tutorials",
    description: "Watch step-by-step guides and feature walkthroughs",
    icon: <LuCirclePlay size={22} />,
    // Video Tutorials: hot, chaotic, mid-storm. Distortion and swirl
    // both maxed — reads like film stock under heat and motion. Tighter
    // scale puts more colour churn on screen; large opposite-direction
    // offset guarantees the two cards never share a frame.
    mesh: {
      colors: ["#3d0c0c", "#7f1d1d", "#dc2626", "#f97316", "#fbbf24"],
      distortion: 1.0,
      swirl: 1.0,
      speed: 0.85,
      scale: 0.6,
      grainMixer: 0.32,
      grainOverlay: 0.4,
      offsetX: 0.7,
      offsetY: -0.6,
    },
    href: "https://www.youtube.com/@LangWatch/videos",
    cta: "Watch videos",
  },
];

type ResourceCardItemProps = {
  resource: ResourceCard;
};

/**
 * Single resource card
 */
function ResourceCardItem({ resource }: ResourceCardItemProps) {
  const reduceMotion = useReducedMotion();
  return (
    <ChakraLink
      href={resource.href}
      target="_blank"
      rel="noopener noreferrer"
      _hover={{ textDecoration: "none" }}
      height="full"
      width="full"
    >
      <Box
        position="relative"
        borderRadius="xl"
        overflow="hidden"
        height="full"
        width="full"
        transition="all 0.2s ease-in-out"
        _hover={{ opacity: 0.92 }}
      >
        {/* MeshGradient backdrop, scoped to this card. Card-specific
            palette so each card keeps its accent identity (cool blue for
            docs, warm red for videos). */}
        <Box position="absolute" inset={0} pointerEvents="none">
          <MeshGradient
            colors={resource.mesh.colors}
            distortion={resource.mesh.distortion}
            swirl={resource.mesh.swirl}
            grainMixer={resource.mesh.grainMixer}
            grainOverlay={resource.mesh.grainOverlay}
            speed={reduceMotion ? 0 : resource.mesh.speed}
            scale={resource.mesh.scale}
            offsetX={resource.mesh.offsetX}
            offsetY={resource.mesh.offsetY}
            style={{ width: "100%", height: "100%" }}
          />
        </Box>
        {/* Soft tint over the shader so foreground text stays readable
            against the moving mesh. */}
        <Box
          position="absolute"
          inset={0}
          pointerEvents="none"
          backgroundImage="linear-gradient(135deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 100%)"
        />
        <VStack
          position="relative"
          align="start"
          padding={4}
          gap={3}
          height="full"
          width="full"
          color="white"
        >
          <HStack gap={3} align="start">
            <Box padding={2} borderRadius="lg" color="white" opacity={0.95}>
              {resource.icon}
            </Box>
            <VStack align="start" gap={1} flex={1}>
              <Text fontWeight="semibold" fontSize="sm">
                {resource.title}
              </Text>
              <Text fontSize="xs" color="white/80">
                {resource.description}
              </Text>
              <HStack color="white" fontSize="xs" fontWeight="medium">
                <Text>{resource.cta}</Text>
                <LuExternalLink size={12} />
              </HStack>
            </VStack>
          </HStack>
        </VStack>
      </Box>
    </ChakraLink>
  );
}

/**
 * LearningResources
 * Section with links to documentation and video tutorials.
 */
export function LearningResources() {
  return (
    <VStack align="stretch" gap={3} width="full">
      <Heading>Learning resources</Heading>
      <Grid
        templateColumns={{
          base: "1fr",
          md: "repeat(2, 1fr)",
        }}
        gap={3}
        width="full"
      >
        {resources.map((resource) => (
          <ResourceCardItem key={resource.title} resource={resource} />
        ))}
      </Grid>
      <Text fontSize="13px" color="fg.muted" paddingTop={2}>
        Considering LangWatch for your team?{" "}
        <Link
          href="https://langwatch.ai/get-a-demo"
          isExternal
          color="fg.muted"
          textDecoration="underline"
          _hover={{ color: "orange.500" }}
        >
          Request a demo
        </Link>
      </Text>
    </VStack>
  );
}
