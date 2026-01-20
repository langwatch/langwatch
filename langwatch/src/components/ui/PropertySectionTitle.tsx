import { Box, HStack, type StackProps, Text } from "@chakra-ui/react";
import { Info } from "react-feather";
import { Tooltip } from "./tooltip";

export type PropertySectionTitleProps = {
  children: React.ReactNode;
  tooltip?: React.ReactNode;
} & StackProps;

export function PropertySectionTitle({
  children,
  tooltip,
  ...props
}: PropertySectionTitleProps) {
  return (
    <HStack paddingLeft={2} {...props}>
      <Text
        fontSize="12px"
        fontWeight="bold"
        textTransform="uppercase"
        color="gray.500"
      >
        {children}
      </Text>
      {tooltip && (
        <Tooltip content={tooltip}>
          <Box marginBottom="-2px">
            <Info size={14} />
          </Box>
        </Tooltip>
      )}
    </HStack>
  );
}
