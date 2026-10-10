import { Popover, PopoverTrigger } from "@langwatch/design-system/popover";
import { IconButton, HStack, Spacer, Text, VStack } from "@langwatch/design-system/primitives";
import { X } from "lucide-react";
import { type ReactNode, useState } from "react";

export function WorkflowConfigPopover({
  open,
  onClose,
  title,
  unstyled = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  unstyled?: boolean;
  children: ReactNode;
}) {
  const [localIsOpen, setLocalIsOpen] = useState(open);

  const [openFrom, setOpenFrom] = useState(open);
  if (openFrom !== open) {
    setOpenFrom(open);
    setLocalIsOpen(open);
  }

  if (!localIsOpen) {
    return null;
  }

  return (
    <Popover.Root
      open={localIsOpen}
      onOpenChange={() => {
        setTimeout(() => setLocalIsOpen(false), 10);
        // To fix issue of popover reopening immediately on the trigger button
        setTimeout(onClose, 300);
      }}
      positioning={{ placement: "bottom" }}
    >
      <PopoverTrigger position="absolute" left={0} width="100%" height="32px" zIndex={-1} />
      {unstyled ? (
        children
      ) : (
        <Popover.Content minWidth="600px" gap={0}>
          <HStack
            width="full"
            paddingX={4}
            paddingY={2}
            paddingRight={1}
            borderBottomWidth="1px"
            borderColor="border"
          >
            <Text textStyle="sm" fontWeight="medium">
              {title}
            </Text>
            <Spacer />
            <IconButton
              aria-label="Close workflow settings"
              size="sm"
              variant="ghost"
              onClick={onClose}
            >
              <X size={16} />
            </IconButton>
          </HStack>
          <VStack paddingY={2} paddingX={4} width="full" align="start">
            {children}
          </VStack>
        </Popover.Content>
      )}
    </Popover.Root>
  );
}
