/**
 * Pushing one prompt's latest version to its replicas - a feature-local
 * copy of the shared push dialog. The toast/`HandledErrorAlert` don't travel
 * here (the registry is unreachable); the caller hands down `errorMessage`.
 */

import { Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Text, VStack } from "@langwatch/design-system/primitives";
import { useState } from "react";

/** One replica the picker lists. */
export type PromptCopyItem = {
  id: string;
  fullPath: string;
  handle: string | null;
};

export type PromptPushDialogProps = {
  open: boolean;
  promptName: string;
  copies: readonly PromptCopyItem[];
  isLoading: boolean;
  /** Already resolved to customer-facing copy by the host; absent when fine. */
  errorMessage?: string;
  selectedCopyIds: ReadonlySet<string>;
  isPushing: boolean;
  onClose: () => void;
  onToggleCopy: (copyId: string) => void;
  onPush: () => Promise<void>;
};

export function PromptPushDialog({
  open,
  promptName,
  copies,
  isLoading,
  errorMessage,
  selectedCopyIds,
  isPushing,
  onClose,
  onToggleCopy,
  onPush,
}: PromptPushDialogProps) {
  const [attempted, setAttempted] = useState(false);
  const hasNoCopies = !isLoading && !errorMessage && copies.length === 0;
  const hasCopies = !isLoading && !errorMessage && copies.length > 0;
  const unavailable = pushUnavailableReason({
    isLoading,
    failed: Boolean(errorMessage),
    empty: hasNoCopies,
  });

  const push = () => {
    if (isPushing) return;
    if (selectedCopyIds.size === 0) return setAttempted(true);
    void onPush();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Push to Replicas"
      busy={isPushing}
      primaryAction={{
        label: `Push to ${selectedCopyIds.size} replica${selectedCopyIds.size === 1 ? "" : "s"}`,
        onClick: push,
        loading: isPushing,
        ...(unavailable ? { disabledReason: unavailable } : {}),
      }}
    >
      <VStack gap={4} align="start">
        <Text fontSize="sm" color="fg.muted">
          {`Select which replicas to push the latest version of "${promptName}" to:`}
        </Text>
        {isLoading && <Text>Loading replicas...</Text>}
        {!isLoading && errorMessage && (
          <Text role="alert" color="red.fg">
            {errorMessage}
          </Text>
        )}
        {hasNoCopies && (
          <NoDataInfoBlock
            size="line"
            title="No replicas found. Use Replicate on the prompt's menu to create one."
            next={[
              {
                kind: "docs",
                label: "Prompt management",
                href: "https://docs.langwatch.ai/prompt-management/overview",
              },
            ]}
          />
        )}
        {hasCopies && (
          <VStack gap={2} align="start" width="full">
            {copies.map((copy) => (
              <Checkbox
                key={copy.id}
                checked={selectedCopyIds.has(copy.id)}
                onChange={() => onToggleCopy(copy.id)}
              >
                <VStack align="start" gap={0}>
                  <Text fontWeight="medium">{copy.handle ?? copy.id}</Text>
                  <Text fontSize="sm" color="fg.muted">
                    {copy.fullPath}
                  </Text>
                </VStack>
              </Checkbox>
            ))}
          </VStack>
        )}
        {attempted && hasCopies && selectedCopyIds.size === 0 && (
          <Text role="alert" color="red.fg" textStyle="sm">
            Select at least one replica to push to.
          </Text>
        )}
      </VStack>
    </Dialog>
  );
}

function pushUnavailableReason({
  isLoading,
  failed,
  empty,
}: {
  isLoading: boolean;
  failed: boolean;
  empty: boolean;
}) {
  if (isLoading) return "Replicas are still loading.";
  if (failed) return "Replicas could not be loaded.";
  if (empty) return "There are no replicas to push to.";
  return void 0;
}
