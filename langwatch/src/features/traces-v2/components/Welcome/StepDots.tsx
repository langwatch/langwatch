import { Box, HStack } from "@chakra-ui/react";
import type React from "react";

interface StepDotsProps {
  current: number;
  total: number;
}

export const StepDots: React.FC<StepDotsProps> = ({ current, total }) => (
  <HStack gap={1.5} aria-hidden="true">
    {Array.from({ length: total }).map((_, i) => (
      <Box
        key={i}
        width={i === current ? "20px" : "6px"}
        height="6px"
        borderRadius="full"
        bg={i === current ? "blue.solid" : "border.emphasized"}
        transition="all 0.2s ease"
      />
    ))}
  </HStack>
);
