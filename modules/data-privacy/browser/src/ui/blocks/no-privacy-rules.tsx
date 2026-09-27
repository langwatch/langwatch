import { Button, Card, EmptyState, VStack } from "@chakra-ui/react";
import { Plus, Shield } from "lucide-react";

/** What the page shows before any rule exists: the defaults, and the way to change them. */
export function NoPrivacyRules({ canWrite, onAdd }: { canWrite: boolean; onAdd: () => void }) {
  return (
    <Card.Root width="full">
      <Card.Body>
        <EmptyState.Root width="full">
          <EmptyState.Content>
            <EmptyState.Indicator>
              <Shield size={24} />
            </EmptyState.Indicator>
            <VStack textAlign="center" gap={3}>
              <VStack textAlign="center" gap={1}>
                <EmptyState.Title>No privacy rules</EmptyState.Title>
                <EmptyState.Description>
                  Secrets redaction and essential PII redaction are on by default, and content is
                  captured and visible to your team. Add a rule to change that at any scope.
                </EmptyState.Description>
              </VStack>
              {canWrite && (
                <Button colorPalette="blue" variant="outline" onClick={onAdd}>
                  <Plus /> Add privacy rule
                </Button>
              )}
            </VStack>
          </EmptyState.Content>
        </EmptyState.Root>
      </Card.Body>
    </Card.Root>
  );
}
