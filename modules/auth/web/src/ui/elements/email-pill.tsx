import { Button, HStack, Text } from "@chakra-ui/react";

/** Address pill for credential step; shows address, provides way back to change it. */
export function EmailPill({
  email,
  actionLabel,
  onAction,
  testId,
}: {
  email: string;
  /** What the way back is called here — the doors word it differently. */
  actionLabel: string;
  onAction: () => void;
  testId?: string;
}) {
  return (
    <HStack
      width="full"
      justify="space-between"
      backgroundColor="bg.subtle"
      borderWidth="1px"
      borderRadius="full"
      paddingX="14px"
      paddingY="7px"
    >
      <Text fontSize="13px" color="fg.muted" truncate data-testid={testId}>
        {email}
      </Text>
      <Button
        variant="plain"
        size="xs"
        fontSize="12px"
        textDecoration="underline"
        textUnderlineOffset="2px"
        flexShrink={0}
        onClick={onAction}
      >
        {actionLabel}
      </Button>
    </HStack>
  );
}
