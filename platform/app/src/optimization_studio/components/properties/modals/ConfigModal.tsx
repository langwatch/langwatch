import {
  Button,
  HStack,
  PopoverTrigger,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { X } from "react-feather";
import { Popover } from "../../../../components/ui/popover";

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
      positioning={{ placement: "bottom" }}
    >
      <PopoverTrigger
        position="absolute"
        left={0}
        width="100%"
        height="32px"
        zIndex={-1}
      />
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
