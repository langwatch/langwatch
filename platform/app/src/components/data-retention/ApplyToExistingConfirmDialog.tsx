import { Alert, Button, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "~/components/ui/dialog";
import { INDEFINITE_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";

export function ApplyToExistingConfirmDialog({
  pending,
  isApplying,
  onCancel,
  onConfirm,
}: {
  pending: {
    retentionDays: number;
    savedScopeWiderThanCurrentProject: boolean;
  } | null;
  isApplying: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Dialog.Root
      open={!!pending}
      onOpenChange={({ open }) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Apply retention to existing data?</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {pending && (
            <VStack align="stretch" gap={3}>
              {pending.retentionDays === INDEFINITE_RETENTION_DAYS ? (
                <Text>
                  We will rewrite <strong>this project's</strong> existing data
                  to be kept indefinitely. No rows are deleted — this removes
                  the retention limit from already-stored data.
                </Text>
              ) : (
                // We don't name a specific day count here because the server
                // applies the project's RESOLVED effective retention
                // (PROJECT > TEAM > ORGANIZATION > platform default), which
                // may differ from the value the user just selected (e.g. when
                // saving an org-wide rule but the project has a closer
                // override). The toast that fires after the apply shows the
                // value that was actually used.
                <Text>
                  We will rewrite <strong>this project's</strong> existing data
                  to use its currently resolved retention policy. Rows older
                  than the resolved retention become eligible for deletion on
                  the next background merge. After deletion, this cannot be
                  undone.
                </Text>
              )}
              {pending.savedScopeWiderThanCurrentProject && (
                <Alert.Root status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>
                      You also saved an organization or team policy. New rows
                      across those scopes will use the new retention, but
                      existing rows in other projects keep their current
                      retention until each project is visited and applied
                      individually.
                    </Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              )}
            </VStack>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            colorPalette={
              pending?.retentionDays === INDEFINITE_RETENTION_DAYS
                ? "blue"
                : "red"
            }
            loading={isApplying}
            onClick={() => void onConfirm()}
          >
            Apply to existing data
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
