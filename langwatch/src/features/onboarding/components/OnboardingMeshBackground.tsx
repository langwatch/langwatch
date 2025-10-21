import React from "react";
import { Box } from "@chakra-ui/react";
import { motion } from "motion/react";

const MotionBox = motion(Box);

export const OnboardingMeshBackground: React.FC<{ opacity?: number; blurPx?: number }> = ({ opacity = 0.3, blurPx = 60 }) => (
  <Box position="absolute" maxW="full" maxH="dvh" inset={0} zIndex={0} pointerEvents="none" overflow="hidden" opacity={opacity} filter={`blur(${blurPx}px)`}>
    <MotionBox
      position="absolute"
      top="-20%"
      left="-25%"
      w="60vw"
      h="60vw"
      borderRadius="full"
      style={{
        background:
          "radial-gradient(circle at 20% 30%, #ED8926 0%, rgba(237,137,38,0.6) 35%, transparent 65%)",
        mixBlendMode: "multiply",
      }}
      initial={{ scale: 1 }}
      animate={{ scale: [1, 1.5, 0.75, 1] }}
      transition={{ duration: 10, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
    />
    <MotionBox
      position="absolute"
      top="-15%"
      right="-30%"
      w="70vw"
      h="70vw"
      borderRadius="full"
      style={{
        background:
          "radial-gradient(circle at 80% 25%, #E17100 0%, rgba(225,113,0,0.6) 35%, transparent 65%)",
        mixBlendMode: "multiply",
      }}
      initial={{ scale: 1 }}
      animate={{ scale: [1, 0.5, 1] }}
      transition={{ duration: 10, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
    />
  </Box>
);

export default OnboardingMeshBackground;
