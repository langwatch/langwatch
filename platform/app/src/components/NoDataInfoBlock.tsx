import { Center, EmptyState, Icon, VStack } from "@chakra-ui/react";

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
  children?: React.ReactNode;
}) => {
  return (
    <Center flex={1} padding={6}>
      <EmptyState.Root>
        <EmptyState.Content>
          <EmptyState.Indicator>
            <Icon size={"lg"}>{icon}</Icon>
          </EmptyState.Indicator>
          <EmptyState.Title>{title}</EmptyState.Title>
          {/* EmptyState.Description renders a <p>, so anything block-level
              (docsInfo, children) must sit beside it, not inside it. */}
          <EmptyState.Description>{description}</EmptyState.Description>
          {(docsInfo ?? children) != null && (
            <VStack align="center" textStyle="sm" color="fg.muted">
              {docsInfo}
              {children}
            </VStack>
          )}
        </EmptyState.Content>
      </EmptyState.Root>
    </Center>
  );
};
