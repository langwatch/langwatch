import { Button, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { Checkbox } from "./checkbox";
import { Dialog } from "./dialog";
import { toaster } from "./toaster";

export type PushToCopiesCopyItem = {
  id: string;
  fullPath: string;
  name?: string;
  handle?: string;
};

function getCopyLabel(copy: PushToCopiesCopyItem): string {
  return copy.name ?? copy.handle ?? copy.id;
}

export type PushToCopiesDialogProps = {
  open: boolean;
  onClose: () => void;
  entityLabel: string;
  sourceName: string;
  copies: PushToCopiesCopyItem[];
  isLoading: boolean;
  /** Query error (e.g. TRPCClientErrorLike or Error) */
  error: { message: string } | null;
  selectedCopyIds: Set<string>;
  onToggleCopy: (id: string) => void;
  onPush: () => Promise<{ pushedTo: number; selectedCopies: number }>;
  pushLoading: boolean;
  /** Optional override for "No replicas found." */
  emptyMessage?: ReactNode;
  /** Optional override for the body intro (default: "Select which replicas to push the latest config to:") */
  bodyIntro?: ReactNode;
  /** Called after successful push, before onClose */
  onSuccess?: () => void;
};

export function PushToCopiesDialog({
  open,
  onClose,
  entityLabel,
  sourceName,
  copies,
  isLoading,
  error,
  selectedCopyIds,
  onToggleCopy,
  onPush,
  pushLoading,
  emptyMessage,
  bodyIntro = "Select which replicas to push the latest config to:",
  onSuccess,
}: PushToCopiesDialogProps) {
  const handlePush = async () => {
    if (selectedCopyIds.size === 0) return;

    try {
      const result = await onPush();

      toaster.create({
        title: `${entityLabel} pushed`,
        description: `"${sourceName}" has been pushed to ${result.pushedTo} of ${result.selectedCopies} selected replicated ${entityLabel.toLowerCase()}(s).`,
        type: "success",
        meta: { closable: true },
      });

      onSuccess?.();
      onClose();
    } catch (err) {
      toaster.create({
        title: `Error pushing ${entityLabel.toLowerCase()}`,
        description:
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Unknown error",
        type: "error",
      });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content onClick={(e) => e.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Push to Replicas</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align={"start"}>
            <Text fontSize="sm" color="fg.muted">
              {bodyIntro}
            </Text>
            {isLoading ? (
              <Text>Loading replicas...</Text>
            ) : error ? (
              <Text color="red.fg">
                Error loading replicas: {error.message}
              </Text>
            ) : copies.length === 0 ? (
              <Text color="fg.muted">
                {emptyMessage ?? "No replicas found."}
              </Text>
            ) : (
              <VStack gap={2} align={"start"} width="full">
                {copies.map((copy) => (
                  <Checkbox
                    key={copy.id}
                    checked={selectedCopyIds.has(copy.id)}
                    onChange={() => onToggleCopy(copy.id)}
                  >
                    <VStack align={"start"} gap={0}>
                      <Text fontWeight="medium">{getCopyLabel(copy)}</Text>
                      <Text fontSize="sm" color="fg.muted">
                        {copy.fullPath}
                      </Text>
                    </VStack>
                  </Checkbox>
                ))}
              </VStack>
            )}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            onClick={() => void handlePush()}
            loading={pushLoading}
            disabled={selectedCopyIds.size === 0 || isLoading}
          >
            Push to {selectedCopyIds.size} replica
            {selectedCopyIds.size !== 1 ? "s" : ""}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
