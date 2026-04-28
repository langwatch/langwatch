import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";

interface SetupStepProps {
  number: number;
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
}

export const SetupStep = ({
  number,
  icon,
  title,
  description,
}: SetupStepProps) => {
  return (
    <HStack align="start" gap={3} width="full">
      <Box
        flexShrink={0}
        width="20px"
        height="20px"
        borderRadius="full"
        bg="bg.emphasized"
        display="flex"
        alignItems="center"
        justifyContent="center"
        textStyle="xs"
        fontWeight="bold"
        color="fg.muted"
      >
        {number}
      </Box>
      <VStack align="start" gap={1} flex={1}>
        <HStack gap={1.5}>
          <Box color="fg.muted">{icon}</Box>
          <Text textStyle="sm" fontWeight="medium">
            {title}
          </Text>
        </HStack>
        {description}
      </VStack>
    </HStack>
  );
};
