import {
  Button,
  HStack,
  PopoverTrigger,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Popover } from "../../../../components/ui/popover";
import { useState, useEffect } from "react";
import { X } from "react-feather";

export function ConfigModal({
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
  children: React.ReactNode;
}) {
  const [localIsOpen, setLocalIsOpen] = useState(open);

  useEffect(() => {
    setLocalIsOpen(open);
  }, [open]);

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
    >
      <PopoverTrigger
        position="absolute"
        left={0}
        width="100%"
        height="80px"
        zIndex={-1}
      />
      {unstyled ? (
        children
      ) : (
        <Popover.Content
          borderRadius="2px"
          borderWidth="1px"
          borderColor="gray.200"
          bg="white"
          minWidth="600px"
          gap={0}
          boxShadow="0px 0px 10px rgba(0, 0, 0, 0.1)"
        >
          <HStack
            width="full"
            paddingX={4}
            paddingY={2}
            paddingRight={1}
            borderBottomWidth="1px"
            borderColor="gray.200"
          >
            <Text fontSize="14px" fontWeight={500}>
              {title}
            </Text>
            <Spacer />
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X size={16} />
            </Button>
          </HStack>
          <VStack paddingY={2} paddingX={4} width="full" align="start">
            {children}
          </VStack>
        </Popover.Content>
      )}
    </Popover.Root>
  );
}
