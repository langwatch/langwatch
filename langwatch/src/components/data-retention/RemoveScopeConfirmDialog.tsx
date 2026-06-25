import { Alert, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
import { Dialog } from "~/components/ui/dialog";
import { api } from "~/utils/api";
import { renderPolicyValue, type RetentionScopeGroup } from "./grouping";

/**
 * Confirms removal of a scope's retention policy. Removing a rule is not a
 * delete of data — it only changes the retention applied to NEW data, which
 * falls back to the next tier in the cascade (or the platform default). This
 * dialog spells that out and shows the real fallback number resolved
 * server-side (never a guessed value), so a user can't mistake "remove rule"
 * for "delete my traces" — the fear that prompted this UI.
 */
export function RemoveScopeConfirmDialog({
  group,
  projectId,
  isRemoving,
  onCancel,
  onConfirm,
}: {
  group: RetentionScopeGroup | null;
  projectId: string;
  isRemoving: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const previewQuery = api.dataRetention.previewScopeRemoval.useQuery(
    {
      projectId,
      scope: group
        ? { scopeType: group.scopeType, scopeId: group.scopeId }
        : { scopeType: "PROJECT", scopeId: "" },
    },
    { enabled: !!group },
  );

  const current = group ? renderPolicyValue(group.byCategory) : "—";
  const fallback = previewQuery.data
    ? renderPolicyValue(previewQuery.data)
    : null;

  return (
    <Dialog.Root
      open={!!group}
      onOpenChange={({ open }) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>
            Remove retention policy{group ? ` for ${group.name}` : ""}?
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {group && (
            <VStack align="stretch" gap={4}>
              <Text>
                This removes the override only. <strong>No data is deleted</strong>{" "}
                — existing data keeps the retention it was already stored with.
                The change applies to newly ingested data from now on.
              </Text>

              <VStack
                align="stretch"
                gap={1}
                padding={3}
                borderWidth="1px"
                borderColor="border"
                borderRadius="md"
                background="bg.subtle"
              >
                <Text fontSize="xs" color="fg.muted">
                  Retention for {group.name}
                </Text>
                {previewQuery.isLoading ? (
                  <HStack gap={2}>
                    <Spinner size="sm" />
                    <Text fontSize="sm" color="fg.muted">
                      Resolving fallback…
                    </Text>
                  </HStack>
                ) : (
                  <HStack gap={2}>
                    <Text fontWeight="600">{current}</Text>
                    <ArrowRight size={14} />
                    <Text fontWeight="600">{fallback ?? "the next policy"}</Text>
                  </HStack>
                )}
                <Text fontSize="xs" color="fg.muted">
                  Falls back to the next applicable policy, or the platform
                  default when none is closer.
                </Text>
              </VStack>

              {previewQuery.isError && (
                <Alert.Root status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>
                      Couldn't preview the fallback retention. Removing still
                      falls back to the next applicable policy.
                    </Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              )}
            </VStack>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onCancel} disabled={isRemoving}>
            Cancel
          </Button>
          <Button
            colorPalette="red"
            loading={isRemoving}
            onClick={() => void onConfirm()}
          >
            Remove policy
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
