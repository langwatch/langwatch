import {
  Box,
  Button,
  Center,
  HStack,
  RadioCard,
  Text,
  VStack,
  type ButtonProps,
} from "@chakra-ui/react";
import { LuChevronRight } from "react-icons/lu";
import { OverflownTextWithTooltip } from "../OverflownText";

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

export function StepRadio({
  title,
  description,
  icon,
  value,
  ...props
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  value: string;
} & RadioCard.ItemProps) {
  return (
    <RadioCard.Item value={value} width="full" minWidth={0} {...props}>
      <RadioCard.ItemHiddenInput />
      <RadioCard.ItemControl cursor="pointer" width="full">
        <RadioCard.ItemContent width="full">
          <HStack align="start" gap={3} width="full">
            {icon}
            <VStack align="start" gap={1} width="full">
              <OverflownTextWithTooltip>{title}</OverflownTextWithTooltip>
              <Text fontSize="sm" color="gray.500" fontWeight="normal">
                {description}
              </Text>
            </VStack>
          </HStack>
        </RadioCard.ItemContent>
        <RadioCard.ItemIndicator />
      </RadioCard.ItemControl>
    </RadioCard.Item>
  );
}
