import { Alert, Button } from "@langwatch/design-system/primitives";

import { storedRetentionNote } from "../../model/stored-retention-copy.ts";

/** Stored data under the scope in view still kept past its period, with a way to apply it. */
export function StoredRetentionNote({
  rows,
  canApply,
  onApply,
}: {
  rows: number;
  canApply: boolean;
  onApply: () => void;
}) {
  return (
    <Alert.Root status="warning" data-testid="stored-retention-note">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{storedRetentionNote({ rows })}</Alert.Title>
      </Alert.Content>
      {canApply && (
        <Button size="sm" variant="outline" onClick={onApply}>
          Apply
        </Button>
      )}
    </Alert.Root>
  );
}
