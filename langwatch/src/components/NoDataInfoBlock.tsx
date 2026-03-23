import { Box, Center, EmptyState, Icon, VStack } from "@chakra-ui/react";

export const NoDataInfoBlock = ({
  title,
  description,
  icon,
  docsInfo,
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
    <Center flex={1} padding={6}>
      <EmptyState.Root>
        <EmptyState.Content>
          <EmptyState.Indicator>
            <Icon size={"lg"}>
              {icon}
            </Icon>
          </EmptyState.Indicator>
          <EmptyState.Title>{title}</EmptyState.Title>
          <EmptyState.Description>
            <Center>
              <VStack align="center">
                <Box>{description}</Box>
                <Box>
                  {docsInfo}
                </Box>
                {children}
              </VStack>
            </Center>
          </EmptyState.Description>
        </EmptyState.Content>
      </EmptyState.Root>
    </Center>
  );
};
