/** The one empty state: a card with a circled icon, title, description and optional actions. */
import { Box, Icon, Text, VStack } from "@chakra-ui/react";

export const NoDataInfoBlock = ({
  title,
  description,
  icon,
  docsInfo,
  children,
  testId,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  docsInfo?: React.ReactNode;
  color?: string;
  children?: React.ReactNode;
  testId?: string;
}) => {
  return (
    <VStack
      data-testid={testId}
      align="center"
      gap={0}
      width="full"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="14px"
      background="bg.surface"
      paddingX={6}
      paddingY={10}
      textAlign="center"
    >
      <Box
        color="fg.subtle"
        display="grid"
        placeItems="center"
        width="44px"
        height="44px"
        borderRadius="full"
        borderWidth="1px"
        borderColor="border.muted"
        background="bg.muted"
        marginBottom={4}
      >
        <Icon size="md">{icon}</Icon>
      </Box>
      <Text
        as="h3"
        fontFamily="heading"
        fontSize="20px"
        fontWeight="500"
        letterSpacing="-0.02em"
        color="fg"
      >
        {title}
      </Text>
      <Text
        textStyle="sm"
        color="fg.muted"
        lineHeight="1.5"
        textWrap="balance"
        maxWidth="420px"
        marginTop={2}
      >
        {description}
      </Text>
      {(docsInfo ?? children) != null && (
        <VStack align="center" gap={2} marginTop={5} textStyle="sm" color="fg.muted">
          {docsInfo}
          {children}
        </VStack>
      )}
    </VStack>
  );
};
