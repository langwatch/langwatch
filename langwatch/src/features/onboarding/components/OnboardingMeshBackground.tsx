import React from "react";
import { Box } from "@chakra-ui/react";
import { motion } from "motion/react";

const MotionBox = motion(Box);

export const OnboardingMeshBackground: React.FC<{ opacity?: number; blurPx?: number }> = ({ opacity = 0.3, blurPx = 60 }) => (
  <Box position="absolute" inset={0} zIndex={0} pointerEvents="none" overflow="hidden" opacity={opacity} filter={`blur(${blurPx}px)`}>
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
      animate={{ scale: [1, 1.08, 1] }}
      transition={{ duration: 9, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
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
      animate={{ scale: [1, 1.06, 1] }}
      transition={{ duration: 10, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: 0.8 }}
    />
    <MotionBox
      position="absolute"
      bottom="-30%"
      left="5%"
      w="80vw"
      h="80vw"
      borderRadius="full"
      style={{
        background:
          "radial-gradient(circle at 60% 80%, #FE9A00 0%, rgba(254,154,0,0.6) 35%, transparent 65%)",
        mixBlendMode: "multiply",
      }}
      initial={{ scale: 1 }}
      animate={{ scale: [1, 1.07, 1] }}
      transition={{ duration: 11, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: 0.4 }}
    />
  </Box>
);

export default OnboardingMeshBackground;


