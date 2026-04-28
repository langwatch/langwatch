import {
  Box,
  Link as ChakraLink,
  Grid,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { GrainGradient, MeshGradient } from "@paper-design/shaders-react";

type GrainShape =
  | "wave"
  | "dots"
  | "truchet"
  | "corners"
  | "ripple"
  | "blob"
  | "sphere";
import { LuBookOpen, LuCirclePlay, LuExternalLink } from "react-icons/lu";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useColorModeValue } from "../ui/color-mode";
import { Link } from "../ui/link";

interface ShaderColors {
  /** Palette in light mode (lifted highlights). */
  colors: string[];
  /** Palette in dark mode (deeper, original tones). */
  colorsDark: string[];
}

interface MeshConfig extends ShaderColors {
  kind: "mesh";
  /** How much the mesh deforms — higher = more organic blobs. */
  distortion: number;
  /** Rotational twist around the centre. */
  swirl: number;
  speed: number;
  scale: number;
  grainMixer: number;
  grainOverlay: number;
  offsetX: number;
  offsetY: number;
}

interface GrainConfig extends ShaderColors {
  kind: "grain";
  /** Pattern primitive — blob/ripple read calmest, dots/truchet most graphic. */
  shape: GrainShape;
  /** Edge softness between bands (0 = hard, 1 = smooth). */
  softness: number;
  /** Distortion between colour bands (0–1). */
  intensity: number;
  /** Grain density (0–1). */
  noise: number;
  /** Back fill behind the gradient — keeps card off pure black in dark mode. */
  colorBack: string;
  colorBackDark: string;
  speed: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

type ShaderConfig = MeshConfig | GrainConfig;

type ResourceCard = {
  title: string;
  description: string;
  icon: React.ReactNode;
  shader: ShaderConfig;
  href: string;
  cta: string;
};

const resources: ResourceCard[] = [
  {
    title: "Documentation",
    description: "Learn how to integrate and use LangWatch effectively",
    icon: <LuBookOpen size={18} />,
    // Documentation: cool, calm, almost-still. Grain shader in `blob`
    // mode — soft cloud forms with a subtle film grain over the top.
    shader: {
      kind: "grain",
      colors: ["#0c1c3d", "#1e3a8a", "#3b82f6", "#67e8f9", "#a5f3fc"],
      colorsDark: ["#0c1c3d", "#1e3a8a", "#2563eb", "#06b6d4", "#22d3ee"],
      shape: "blob",
      softness: 0.85,
      intensity: 0.35,
      noise: 0.18,
      colorBack: "#1e293b",
      colorBackDark: "#bfdbfe",
      speed: 0.1,
      scale: 1.4,
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
    shader: {
      kind: "mesh",
      colors: ["#7f1d1d", "#b91c1c", "#ef4444", "#fb923c", "#fde68a"],
      colorsDark: ["#3d0c0c", "#7f1d1d", "#dc2626", "#f97316", "#fbbf24"],
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
  const shaderColors = useColorModeValue(
    resource.shader.colors,
    resource.shader.colorsDark,
  );
  const grainColorBack = useColorModeValue(
    resource.shader.kind === "grain" ? resource.shader.colorBack : "",
    resource.shader.kind === "grain" ? resource.shader.colorBackDark : "",
  );
  const tintGradient = useColorModeValue(
    "linear-gradient(135deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.1) 100%)",
    "linear-gradient(135deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.5) 100%)",
  );
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
        boxShadow="0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.12)"
        transition="all 0.2s ease-in-out"
        _hover={{ opacity: 0.92, boxShadow: "0 2px 4px rgba(0,0,0,0.08), 0 12px 32px rgba(0,0,0,0.16)" }}
      >
        {/* Shader backdrop scoped to this card. Card-specific palette
            so each card keeps its accent identity (cool blue for docs,
            warm red for videos). */}
        <Box position="absolute" inset={0} pointerEvents="none">
          {resource.shader.kind === "mesh" ? (
            <MeshGradient
              colors={shaderColors}
              distortion={resource.shader.distortion}
              swirl={resource.shader.swirl}
              grainMixer={resource.shader.grainMixer}
              grainOverlay={resource.shader.grainOverlay}
              speed={reduceMotion ? 0 : resource.shader.speed}
              scale={resource.shader.scale}
              offsetX={resource.shader.offsetX}
              offsetY={resource.shader.offsetY}
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <GrainGradient
              colors={shaderColors}
              colorBack={grainColorBack}
              shape={resource.shader.shape}
              softness={resource.shader.softness}
              intensity={resource.shader.intensity}
              noise={resource.shader.noise}
              speed={reduceMotion ? 0 : resource.shader.speed}
              scale={resource.shader.scale}
              offsetX={resource.shader.offsetX}
              offsetY={resource.shader.offsetY}
              style={{ width: "100%", height: "100%" }}
            />
          )}
        </Box>
        {/* Soft tint over the shader so foreground text stays readable
            against the moving mesh. */}
        <Box
          position="absolute"
          inset={0}
          pointerEvents="none"
          backgroundImage={tintGradient}
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
