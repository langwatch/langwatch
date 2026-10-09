/** The one empty state: a centred indicator, title, description and optional actions. */
import { Center, EmptyState, Icon, VStack } from "@chakra-ui/react";

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
    <Center data-testid={testId} flex={1} alignSelf="stretch" padding={6}>
      <EmptyState.Root>
        <EmptyState.Content gap={4} textAlign="center">
          <EmptyState.Indicator>
            <Icon size="lg">{icon}</Icon>
          </EmptyState.Indicator>
          <EmptyState.Title>{title}</EmptyState.Title>
          {/* Description renders a <p>: block-level docsInfo and children sit beside it. */}
          <EmptyState.Description
            textStyle="sm"
            color="fg.muted"
            maxWidth="480px"
            textWrap="balance"
          >
            {description}
          </EmptyState.Description>
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
