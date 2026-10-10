import { Button, Field, HStack, Input, List, Spinner, Text, VStack } from "@chakra-ui/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Dialog } from "./dialog.tsx";

export type DestructiveConsequence = {
  label: string;
  action: "archived" | "deleted";
  items: readonly { id: string; name: string }[];
};

export function DeleteConfirmationDialog({
  title = "Are you really sure?",
  description = "This action cannot be undone.",
  open,
  onClose,
  onConfirm,
  closeOnConfirm = true,
  confirmationWord = "delete",
  caseSensitive = false,
  trimConfirmation = false,
  confirmLabel = "Delete",
  isLoading = false,
  isLoadingRelated = false,
  consequences = [],
  inputTestId,
  confirmTestId,
  value,
  onValueChange,
  children,
}: {
  title?: string;
  description?: ReactNode;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  closeOnConfirm?: boolean;
  confirmationWord?: string;
  caseSensitive?: boolean;
  trimConfirmation?: boolean;
  confirmLabel?: string;
  isLoading?: boolean;
  isLoadingRelated?: boolean;
  consequences?: readonly DestructiveConsequence[];
  inputTestId?: string;
  confirmTestId?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
}) {
  const [confirmationText, setConfirmationText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setConfirmationText("");
  }, [open]);

  const typed = value ?? confirmationText;
  const normalized = trimConfirmation ? typed.trim() : typed;
  const matches = caseSensitive
    ? normalized === confirmationWord
    : normalized.toLowerCase() === confirmationWord.toLowerCase();
  const disabled = !matches || isLoading || isLoadingRelated;
  const groups = consequences.filter((group) => group.items.length > 0);
  const confirm = () => {
    if (disabled) return;
    onConfirm();
    if (closeOnConfirm) onClose();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => !nextOpen && onClose()}
      placement="center"
      initialFocusEl={() => inputRef.current}
    >
      <Dialog.Content maxWidth="500px" onClick={(event) => event.stopPropagation()}>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {isLoadingRelated ? (
            <HStack justify="center" paddingY={4} as="output">
              <Spinner size="sm" />
              <Text textStyle="sm">Loading related items...</Text>
            </HStack>
          ) : (
            <VStack align="stretch" gap={4}>
              <Text textStyle="sm">{description}</Text>
              {groups.length > 0 && (
                <VStack
                  align="stretch"
                  gap={3}
                  borderTopWidth="1px"
                  borderColor="border.muted"
                  pt={3}
                >
                  <Text textStyle="sm">This will also affect:</Text>
                  {groups.map((group) => (
                    <VStack key={group.label} align="stretch" gap={1}>
                      <HStack justify="space-between" gap={3}>
                        <Text textStyle="sm" fontWeight="medium">
                          {group.label} ({group.items.length})
                        </Text>
                        <Text textStyle="xs" color="fg.muted">
                          {group.action}
                        </Text>
                      </HStack>
                      <List.Root ps={4} textStyle="sm" color="fg.muted">
                        {group.items.slice(0, 5).map((item) => (
                          <List.Item key={item.id} overflowWrap="anywhere">
                            {item.name}
                          </List.Item>
                        ))}
                        {group.items.length > 5 && (
                          <List.Item>...and {group.items.length - 5} more</List.Item>
                        )}
                      </List.Root>
                    </VStack>
                  ))}
                </VStack>
              )}
              {children}
              <Field.Root>
                <Field.Label textStyle="sm">Type {confirmationWord} to confirm</Field.Label>
                <Input
                  variant="outline"
                  bg="bg.panel"
                  borderColor="border"
                  placeholder={`Type '${confirmationWord}' to confirm`}
                  autoComplete="off"
                  value={typed}
                  onChange={(event) => {
                    event.stopPropagation();
                    setConfirmationText(event.target.value);
                    onValueChange?.(event.target.value);
                  }}
                  ref={inputRef}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") confirm();
                  }}
                  data-testid={inputTestId}
                />
              </Field.Root>
            </VStack>
          )}
        </Dialog.Body>
        <Dialog.Footer gap={2}>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            colorPalette="red"
            variant="solid"
            onClick={confirm}
            disabled={disabled}
            loading={isLoading}
            data-testid={confirmTestId}
          >
            {confirmLabel}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
