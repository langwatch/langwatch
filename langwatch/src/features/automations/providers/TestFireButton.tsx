import { Button, HStack, Icon, Text } from "@chakra-ui/react";
import { Send } from "lucide-react";

/**
 * "Send a test" affordance rendered inside a notify provider's config section,
 * so the author can try the real message right where they entered the
 * destination — no need to scroll to the separate test-fire row. Renders
 * nothing when the drawer didn't supply a test-fire handler.
 */
export function TestFireButton({
  onTestFire,
  loading,
  disabled,
  hint,
}: {
  onTestFire?: () => void;
  loading?: boolean;
  /** True while the destination is incomplete — the send would have nowhere
   *  to go. */
  disabled?: boolean;
  hint?: string;
}) {
  if (!onTestFire) return null;

  return (
    <HStack gap={2}>
      <Button
        size="xs"
        variant="outline"
        width="fit-content"
        loading={loading}
        disabled={disabled}
        onClick={onTestFire}
      >
        <Icon boxSize={3}>
          <Send />
        </Icon>
        Send a test
      </Button>
      {hint ? (
        <Text textStyle="xs" color="fg.muted">
          {hint}
        </Text>
      ) : null}
    </HStack>
  );
}
