import { Button, Field, HStack, Input, Text, Textarea, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { Popover } from "@langwatch/design-system/popover";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useWorkflowStore } from "./hooks/use-workflow-store";
import { WorkflowIcon } from "./workflow-icons";

export type WorkflowEmojiPickerRenderProps = {
  open: boolean;
  onClose: () => void;
  onChange: (emoji: string) => void;
  transform?: string;
};

/** Workflow metadata editor. The app supplies its lazy emoji-picker implementation. */
export function WorkflowNamePopover({
  renderEmojiPicker,
}: {
  renderEmojiPicker: (props: WorkflowEmojiPickerRenderProps) => React.ReactNode;
}) {
  const { name, icon, description, setWorkflow } = useWorkflowStore(
    useShallow((state) => ({
      name: state.name,
      icon: state.icon,
      description: state.description,
      setWorkflow: state.setWorkflow,
    })),
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [localName, setLocalName] = useState(name);
  const [localDescription, setLocalDescription] = useState(description);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setLocalName(name);
      setLocalDescription(description);
    }
  }, [description, isOpen, name]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const focusTimeout = setTimeout(() => nameInputRef.current?.focus(), 50);
    return () => clearTimeout(focusTimeout);
  }, [isOpen]);

  const handleSave = useCallback(() => {
    const updates: Record<string, string> = {};
    if (localName !== name) {
      updates.name = localName;
    }
    if (localDescription !== description) {
      updates.description = localDescription;
    }
    if (Object.keys(updates).length > 0) {
      setWorkflow(updates);
    }
    setIsOpen(false);
  }, [description, localDescription, localName, name, setWorkflow]);

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={({ open }) => {
        if (!open) {
          handleSave();
        }
        setIsOpen(open);
      }}
      positioning={{ placement: "bottom" }}
    >
      <Popover.Trigger asChild>
        <HStack cursor="pointer" _hover={{ opacity: 0.8 }} gap={1.5}>
          <WorkflowIcon icon={icon} size="md" background="none" border="none" />
          <Text lineClamp={1} fontSize="15px" wordBreak="break-all">
            {name}
          </Text>
        </HStack>
      </Popover.Trigger>
      <Popover.Content width="320px">
        <Popover.Arrow />
        <Popover.Body padding={3}>
          <VStack gap={3} align="stretch">
            <Field.Root>
              <Field.Label fontSize="xs" color="fg.muted">
                Name and Icon
              </Field.Label>
              <HStack>
                {renderEmojiPicker({
                  open: isEmojiPickerOpen,
                  onClose: () => setIsEmojiPickerOpen(false),
                  onChange: (emoji) => setWorkflow({ icon: emoji }),
                  transform: "translateY(48%)",
                })}
                <Tooltip content="Change icon" positioning={{ placement: "top" }} openDelay={200}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEmojiPickerOpen(true)}
                    fontSize="18px"
                    flexShrink={0}
                  >
                    {icon}
                  </Button>
                </Tooltip>
                <Input
                  ref={nameInputRef}
                  size="sm"
                  value={localName}
                  onChange={(event) => setLocalName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleSave();
                    }
                  }}
                />
              </HStack>
            </Field.Root>
            <Field.Root>
              <Field.Label fontSize="xs" color="fg.muted">
                Description
              </Field.Label>
              <Textarea
                size="sm"
                value={localDescription}
                onChange={(event) => setLocalDescription(event.target.value)}
                placeholder="Add a description..."
                rows={2}
              />
            </Field.Root>
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
