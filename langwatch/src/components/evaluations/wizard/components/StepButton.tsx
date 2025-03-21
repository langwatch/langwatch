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
import { OverflownTextWithTooltip } from "../../../OverflownText";

export function StepButton({
  title,
  value,
  description,
  icon,
  indicator,
  ...props
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  indicator?: React.ReactNode | null;
} & RadioCard.ItemProps) {
  return (
    <RadioCard.Item value={value} width="full" minWidth={0} {...props}>
      <RadioCard.ItemHiddenInput />
      <RadioCard.ItemControl cursor="pointer" width="full" alignItems="center">
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
        <RadioCard.ItemIndicator opacity={0} />
        {indicator ?? <LuChevronRight size={20} />}
      </RadioCard.ItemControl>
    </RadioCard.Item>
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
