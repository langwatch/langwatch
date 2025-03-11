import {
  Box,
  Button,
  Center,
  HStack,
  Text,
  VStack,
  type ButtonProps,
} from "@chakra-ui/react";
import { LuChevronRight } from "react-icons/lu";

export function StepButton({
  title,
  description,
  icon,
  indicator,
  ...props
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  indicator?: React.ReactNode | null;
} & ButtonProps) {
  return (
    <Button
      variant="outline"
      size="lg"
      width="full"
      padding={2}
      paddingY={3}
      height="auto"
      {...props}
    >
      <HStack width="full" alignItems="stretch">
        <Box paddingX={2} paddingY={1}>
          {icon}
        </Box>
        <VStack width="full" align="start" gap={1}>
          <Text>{title}</Text>
          <Text
            fontSize="sm"
            fontWeight="normal"
            lineClamp={2}
            textAlign="left"
            lineHeight="1.3"
            color="gray.600"
          >
            {description}
          </Text>
        </VStack>
        {indicator !== null && (
          <Center>{indicator ?? <LuChevronRight />}</Center>
        )}
      </HStack>
    </Button>
  );
}
