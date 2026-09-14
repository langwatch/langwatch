import { Button, HStack, Text } from "@chakra-ui/react";

/**
 * The address a credential step is for, settled into a quiet pill with the
 * way back out of it.
 *
 * Both doors reach a step where the address is already decided and the only
 * thing left is a secret. Showing it there is not decoration: it is the one
 * chance to notice a typo before it becomes an account, and without it the
 * screen asks for a password with no visible answer to "for what?".
 *
 * It is not editable in place. The address has to travel with the form for a
 * password manager to save the pair, and a field somebody can edit after their
 * manager has read it saves the wrong pair. So the way to change it is to go
 * back and type it again, which is also the way that re-runs everything the
 * address decides.
 */
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
