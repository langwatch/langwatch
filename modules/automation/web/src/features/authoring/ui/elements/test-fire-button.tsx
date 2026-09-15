import { Button, HStack, Icon, Text } from "@chakra-ui/react";
import { Send } from "lucide-react";

/** Controlled test-fire affordance for a provider configuration form. */
export function AutomationTestFireButton({
  onTestFire,
  loading,
  disabled,
  hint,
}: {
  onTestFire?: () => void;
  loading?: boolean;
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
