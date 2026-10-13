import type { ResolvedRetention } from "@langwatch/data-retention-contract";
import { Card } from "@langwatch/design-system/card";
import { Dialog } from "@langwatch/design-system/dialog";
import { Alert, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { ArrowRight } from "lucide-react";

import { type RetentionScopeGroup, renderPolicyValue } from "../../model/retention-grouping.ts";

/**
 * Confirms removal of a scope's retention policy, showing the server-side
 * fallback to clarify that removal only affects new data, not existing traces.
 */
export function RemoveScopeConfirmDialog({
  group,
  isRemoving,
  onCancel,
  onConfirm,
  preview,
}: {
  group: RetentionScopeGroup | null;
  isRemoving: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  /** The fallback retention preview for `group`, owned and fetched by the
   *  caller so this component stays transport-free. */
  preview: {
    data: ResolvedRetention | undefined;
    isLoading: boolean;
    isError: boolean;
  };
}) {
  const current = group ? renderPolicyValue(group.byCategory) : "—";
  const fallback = preview.data ? renderPolicyValue(preview.data) : null;

  return (
    <Dialog
      open={!!group}
      onClose={onCancel}
      size="md"
      title={`Remove retention policy${group ? ` for ${group.name}` : ""}?`}
      primaryAction={{
        label: "Remove policy",
        onClick: () => void onConfirm(),
        loading: isRemoving,
        danger: true,
      }}
      busy={isRemoving}
    >
      {group && (
        <VStack align="stretch" gap={4}>
          <Text>
            This removes the override only. <strong>No data is deleted</strong>. Existing data keeps
            the retention it was already stored with. The change applies to newly ingested data from
            now on.
          </Text>

          <Card variant="nested" tone="neutral" padding="sm">
            <VStack align="stretch" gap={1}>
              <Text fontSize="xs" color="fg.muted">
                Retention for {group.name}
              </Text>
              {preview.isLoading ? (
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
                Falls back to the next applicable policy, or the platform default when none is
                closer.
              </Text>
            </VStack>
          </Card>

          {preview.isError && (
            <Alert.Root status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  Couldn't preview the fallback retention. Removing still falls back to the next
                  applicable policy.
                </Alert.Description>
              </Alert.Content>
            </Alert.Root>
          )}
        </VStack>
      )}
    </Dialog>
  );
}
