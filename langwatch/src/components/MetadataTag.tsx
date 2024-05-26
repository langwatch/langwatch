import { HStack, Text } from "@chakra-ui/react";

export const MetadataTag = ({
  label,
  value,
}: {
  label: string;
  value: string;
}) => {
  return (
    <HStack gap={0} fontSize={"smaller"} margin={0}>
      <Text
        borderWidth={1}
        borderColor={"gray.200"}
        paddingX={2}
        borderLeftRadius={"md"}
      >
        {label}:
      </Text>
      <Text
        borderWidth={1}
        borderColor={"gray.200"}
        paddingX={2}
        borderLeft={"none"}
        backgroundColor={"gray.100"}
        borderRightRadius={"md"}
        fontFamily="mono"
      >
        {value}
      </Text>
    </HStack>
  );
};
