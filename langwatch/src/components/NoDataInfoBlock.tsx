import { Box, Text, VStack } from "@chakra-ui/react";

export const NoDataInfoBlock = ({
  title,
  description,
  icon,
  docsInfo,
  color = "orange.400",
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  docsInfo?: React.ReactNode;
  color?: string;
  children?: React.ReactNode;
}) => {
  return (
    <VStack paddingY={"128px"}>
      <Box
        backgroundColor={color}
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
      {children}
    </VStack>
  );
};
