import { Box, HStack, RadioCard, Text, VStack } from "@chakra-ui/react";
import { LuChevronRight } from "react-icons/lu";
import { OverflownTextWithTooltip } from "../../../OverflownText";
import { Tooltip } from "../../../ui/tooltip";

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
  icon?: React.ReactNode;
  value: string;
} & RadioCard.ItemProps) {
  return (
    <Tooltip disabled={!props.disabled} content={"Coming Soon"}>
      <Box>
        <RadioCard.Item
          value={value}
          width="full"
          minWidth={0}
          _active={{ background: "colorPalette.muted/20" }}
          _icon={{ color: "colorPalette.solid" }}
          {...props}
          _disabled={{
            opacity: 0.4,
            pointerEvents: "none",
            cursor: "not-allowed",
          }}
        >
          <RadioCard.ItemHiddenInput />
          <RadioCard.ItemControl cursor="pointer" width="full">
            <RadioCard.ItemContent width="full">
              <HStack
                align="start"
                gap={3}
                width="full"
                _icon={{ width: "22px", height: "22px" }}
              >
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
      </Box>
    </Tooltip>
  );
}
