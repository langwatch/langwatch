import React from "react";
import { Box } from "@chakra-ui/react";
import { motion } from "motion/react";

const MotionBox = motion(Box);

const blobTransitions = {
  duration: 18,
  repeat: Infinity,
  repeatType: "mirror" as const,
  ease: "easeInOut" as const,
};

const blobConfigs = [
  {
    key: "ember",
    style: {
      top: "6%",
      left: "-10%",
      width: "clamp(440px, 56vmax, 960px)",
      height: "clamp(440px, 56vmax, 960px)",
      background:
        "radial-gradient(58% 58% at 28% 32%, rgba(237,137,38,0.58) 0%, rgba(237,137,38,0.36) 40%, rgba(237,137,38,0) 74%)",
    },
    animate: {
      scale: [1, 1.1, 0.97, 1],
      x: [0, -24, 16, 0],
      y: [0, -18, 10, 0],
    },
  },
  {
    key: "ember-glow",
    style: {
      top: "-8%",
      right: "-6%",
      width: "clamp(400px, 50vmax, 880px)",
      height: "clamp(400px, 50vmax, 880px)",
      background:
        "radial-gradient(56% 56% at 70% 28%, rgba(225,113,0,0.5) 0%, rgba(225,113,0,0.3) 36%, rgba(225,113,0,0) 70%)",
    },
    animate: {
      scale: [1, 0.95, 1.06, 1],
      x: [0, 22, -20, 0],
      y: [0, -14, 12, 0],
    },
  },
  {
    key: "amber",
    style: {
      bottom: "-8%",
      left: "-6%",
      width: "clamp(420px, 54vmax, 920px)",
      height: "clamp(420px, 54vmax, 920px)",
      background:
        "radial-gradient(60% 60% at 30% 70%, rgba(255,180,102,0.48) 0%, rgba(255,180,102,0.32) 42%, rgba(255,180,102,0) 76%)",
    },
    animate: {
      scale: [1, 1.07, 0.94, 1],
      x: [0, -18, 18, 0],
      y: [0, 18, -16, 0],
    },
  },
  {
    key: "embers",
    style: {
      bottom: "2%",
      right: "-4%",
      width: "clamp(360px, 46vmax, 820px)",
      height: "clamp(360px, 46vmax, 820px)",
      background:
        "radial-gradient(52% 52% at 72% 72%, rgba(255,149,64,0.42) 0%, rgba(255,149,64,0.28) 40%, rgba(255,149,64,0) 74%)",
    },
    animate: {
      scale: [1, 1.03, 0.92, 1.02, 1],
      x: [0, 18, -16, 10, 0],
      y: [0, 20, -12, 8, 0],
    },
  },
] as const;

export const OnboardingMeshBackground: React.FC<{ opacity?: number; blurPx?: number }> = ({ opacity = 0.28, blurPx = 70 }) => (
  <Box
    position="fixed"
    inset={0}
    w="100vw"
    h="100dvh"
    pointerEvents="none"
    overflow="hidden"
    zIndex={0}
    opacity={opacity}
    filter={`blur(${blurPx}px)`}
  >
    {blobConfigs.map(({ key, style, animate }) => (
      <MotionBox
        key={key}
        position="absolute"
        borderRadius="full"
        style={{
          ...style,
          mixBlendMode: "screen",
        }}
        initial={{ scale: 1 }}
        animate={{
          scale: [...animate.scale],
          x: [...animate.x],
          y: [...animate.y],
        }}
        transition={blobTransitions}
      />
    ))}
  </Box>
);

export default OnboardingMeshBackground;
