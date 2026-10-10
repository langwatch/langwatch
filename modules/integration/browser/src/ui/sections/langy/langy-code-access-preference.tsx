/**
 * The remembered answer to "how should Langy reach my code" (ADR-129), letting the reader take
 * it back. Hangs off the Integrations screen's GitHub card, which reads and clears the choice.
 */
import { Button, Card, Heading, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { GitHub } from "react-feather";

export function LangyCodeAccessPreference({
  standalone = false,
  isClearing,
  onClear,
}: {
  standalone?: boolean;
  isClearing: boolean;
  onClear: () => void;
}) {
  const line = (
    <HStack
      gap={3}
      justifyContent="space-between"
      borderTopWidth={standalone ? "0" : "1px"}
      borderColor="border.muted"
      paddingTop={standalone ? 0 : 3}
    >
      <Text fontSize="sm" color="fg.muted">
        Langy uses GitHub for code changes
      </Text>
      <Button size="sm" variant="outline" loading={isClearing} onClick={onClear}>
        Change
      </Button>
    </HStack>
  );

  if (!standalone) return line;

  return (
    <Card.Root id="langy-code-access">
      <Card.Body>
        <VStack align="stretch" gap={2}>
          <HStack gap={2}>
            <GitHub size={18} />
            <Heading size="sm">Langy code access</Heading>
          </HStack>
          {line}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
