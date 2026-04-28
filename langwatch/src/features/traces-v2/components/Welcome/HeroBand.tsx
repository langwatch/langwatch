import { Badge, Box, HStack, Heading, Icon, Text, VStack } from "@chakra-ui/react";
import { MeshGradient } from "@paper-design/shaders-react";
import { Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, type FC } from "react";

interface HeroBandProps {
  title: string;
  subtitle: string;
}

/**
 * Persistent backdrop — the MeshGradient WebGL shader is expensive to mount
 * and runs an ongoing time-based animation. Memoising it (and never feeding
 * it changing props) lets it stay alive across step transitions in the
 * welcome dialog so its animation doesn't restart every step.
 */
const HeroBackdrop = memo(() => (
  <Box position="absolute" inset={0} pointerEvents="none">
    <MeshGradient
      style={{ width: "100%", height: "100%" }}
      colors={[
        "#1c0e05", // espresso anchor
        "#451a03", // dark brown
        "#7c2d12", // mahogany
        "#c2410c", // deep orange
        "#f97316", // brand orange highlight
      ]}
      distortion={0.45}
      swirl={0.45}
      grainMixer={0.1}
      grainOverlay={0.12}
      speed={0.35}
    />
  </Box>
));
HeroBackdrop.displayName = "HeroBackdrop";

export const HeroBand: FC<HeroBandProps> = ({ title, subtitle }) => (
  <Box
    position="relative"
    paddingX={6}
    paddingY={6}
    borderRadius="xl"
    overflow="hidden"
    bg="bg.panel"
    minHeight="180px"
  >
    <HeroBackdrop />
    <VStack align="stretch" gap={2} position="relative" color="white">
      <HStack gap={2}>
        <Badge colorPalette="orange" variant="solid" size="sm" borderRadius="full">
          <Icon boxSize={3}>
            <Sparkles />
          </Icon>
          Beta
        </Badge>
        <Text textStyle="xs" color="white/70" fontWeight="medium">
          Traces, Evolved
        </Text>
      </HStack>
      {/* Crossfade just the title+subtitle text so the shader behind keeps
          running unchanged across step changes. */}
      <Box position="relative" minHeight="92px">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            <Heading size="2xl" letterSpacing="-0.02em" color="white">
              {title}
            </Heading>
            <Text color="white/85" textStyle="md" maxWidth="600px">
              {subtitle}
            </Text>
          </motion.div>
        </AnimatePresence>
      </Box>
    </VStack>
  </Box>
);
