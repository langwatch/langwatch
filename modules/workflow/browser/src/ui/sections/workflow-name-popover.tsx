import { EmojiPicker } from "@langwatch/design-system/emoji-picker";
import { Popover } from "@langwatch/design-system/popover";
import { Field, HStack, Input, Text, Textarea, VStack } from "@langwatch/design-system/primitives";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useWorkflowStore } from "../../behavior/use-workflow-store.ts";
import { WorkflowIcon } from "../elements/workflow-icons.tsx";

/** Workflow metadata editor: name, icon and description. */
export function WorkflowNamePopover() {
  const { name, icon, description, setWorkflow } = useWorkflowStore(
    useShallow((state) => ({
      name: state.name,
      icon: state.icon,
      description: state.description,
      setWorkflow: state.setWorkflow,
    })),
  );
  const [isOpen, setIsOpen] = useState(false);
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
          <Text lineClamp={1} textStyle="sectionTitle" wordBreak="break-all">
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
                Name and icon
              </Field.Label>
              <HStack>
                <EmojiPicker
                  size="sm"
                  value={icon}
                  onChange={(emoji) => setWorkflow({ icon: emoji })}
                />
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
