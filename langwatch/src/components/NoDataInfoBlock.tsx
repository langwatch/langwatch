import { Box, Text, VStack } from "@chakra-ui/react";

export const NoDataInfoBlock = ({
  title,
  description,
  icon,
  docsInfo,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  docsInfo?: React.ReactNode;
}) => {
  return (
    <VStack paddingY={"128px"}>
      <Box
        backgroundColor={"orange.400"}
        borderRadius={"50%"}
        padding={4}
        width={"fit-content"}
        color="white"
      >
        {icon}
      </Box>
      <Text fontSize={"lg"} fontWeight={"semibold"}>
        {title}
      </Text>
      <Text>{description}</Text>
      {docsInfo}
    </VStack>
  );
};
