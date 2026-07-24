import {
  Button,
  Field,
  HStack,
  Input,
  Text,
  Textarea,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Popover } from "../../components/ui/popover";
import { Tooltip } from "../../components/ui/tooltip";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { WorkflowIcon } from "./ColorfulBlockIcons";
import { EmojiPickerModal } from "./properties/modals/EmojiPickerModal";
import { useShallow } from "zustand/react/shallow";

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
  const emojiPicker = useDisclosure();
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sync local state when store changes (e.g. from undo/redo)
  useEffect(() => {
    if (!isOpen) {
      setLocalName(name);
      setLocalDescription(description);
    }
  }, [name, description, isOpen]);

  // Focus name input when popover opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleSave = useCallback(() => {
    const updates: Record<string, string> = {};
    if (localName !== name) updates.name = localName;
    if (localDescription !== description)
      updates.description = localDescription;
    if (Object.keys(updates).length > 0) {
      setWorkflow(updates);
    }
    setIsOpen(false);
  }, [localName, localDescription, name, description, setWorkflow]);

  return (
    <>
      <Popover.Root
        open={isOpen}
        onOpenChange={({ open }) => {
          if (!open) handleSave();
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
                  <EmojiPickerModal
                    open={emojiPicker.open}
                    onClose={emojiPicker.onClose}
                    onChange={(emoji) => {
                      setWorkflow({ icon: emoji });
                      emojiPicker.onClose();
                    }}
                    transform="translateY(48%)"
                  />
                  <Tooltip
                    content="Change icon"
                    positioning={{ placement: "top" }}
                    openDelay={200}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={emojiPicker.onOpen}
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
                    onChange={(e) => setLocalName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
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
                  onChange={(e) => setLocalDescription(e.target.value)}
                  placeholder="Add a description..."
                  rows={2}
                />
              </Field.Root>
            </VStack>
          </Popover.Body>
        </Popover.Content>
      </Popover.Root>
    </>
  );
}
