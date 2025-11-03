import React from "react";
import { Box } from "@chakra-ui/react";
import { motion } from "motion/react";

const MotionBox = motion(Box);

const blobTransitions = {
  duration: 20,
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
        "radial-gradient(58% 58% at 28% 32%, rgba(237,137,38,0.48) 0%, rgba(237,137,38,1) 40%, rgba(237,137,38,0) 74%)",
    },
    animate: {
      scale: [1, 1.8, 0.8, 1],
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
        "radial-gradient(56% 56% at 70% 28%, rgba(225,113,0,0.45) 0%, rgba(225,113,0,1) 36%, rgba(225,113,0,0) 70%)",
    },
    animate: {
      scale: [1, 0.9, 1.46, 1],
      x: [0, 22, -20, 0],
      y: [0, -14, 12, 0],
    },
  },
] as const;

export const OnboardingMeshBackground: React.FC<{ opacity?: number; blurPx?: number }> = ({ opacity = 0.28, blurPx = 70 }) => (
  <Box
    position="absolute"
    inset={0}
    pointerEvents="none"
    overflow="hidden"
    zIndex={0}
    opacity={opacity}
    filter={`blur(${blurPx}px)`}
    style={{
      contain: "layout paint",
      backfaceVisibility: "hidden",
    }}
  >
    {blobConfigs.map(({ key, style, animate }) => (
      <MotionBox
        key={key}
        position="absolute"
        borderRadius="full"
        style={{
          ...style,
          mixBlendMode: "screen",
          willChange: "transform",
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
