import { Button, HStack, Icon, Text, VStack } from "@langwatch/design-system/primitives";
import { Send } from "lucide-react";

/** Controlled test-fire affordance; the caption says it is a real send using example data. */
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
    <VStack align="stretch" gap={1}>
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
      <Text textStyle="xs" color="fg.muted">
        Delivers a real message to this destination, using example data instead of a real match.
      </Text>
    </VStack>
  );
}
