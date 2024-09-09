import {
  Box,
  Button,
  HStack,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState, useEffect } from "react";
import { X } from "react-feather";

export function ConfigModal({
  isOpen,
  onClose,
  title,
  unstyled = false,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  unstyled?: boolean;
  children: React.ReactNode;
}) {
  const [localIsOpen, setLocalIsOpen] = useState(isOpen);

  useEffect(() => {
    setLocalIsOpen(isOpen);
  }, [isOpen]);

  if (!localIsOpen) {
    return null;
  }

  return (
    <Popover
      isOpen={localIsOpen}
      onClose={() => {
        setTimeout(() => setLocalIsOpen(false), 10);
        // To fix issue of popover reopening immediately on the trigger button
        setTimeout(onClose, 300);
      }}
      placement="auto-start"
    >
      <PopoverAnchor>
        <Box
          position="absolute"
          left={0}
          width="100%"
          height="80px"
          zIndex={-1}
        />
      </PopoverAnchor>
      {unstyled ? (
        children
      ) : (
        <PopoverContent
          borderRadius="2px"
          border="1px solid"
          borderColor="gray.200"
          background="white"
          minWidth="600px"
          gap={0}
          boxShadow="0px 0px 10px rgba(0, 0, 0, 0.1)"
        >
          <HStack
            width="full"
            paddingX={4}
            paddingY={2}
            paddingRight={1}
            borderBottom="1px solid"
            borderColor="gray.200"
          >
            <Text fontSize={14} fontWeight={500}>
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
        </PopoverContent>
      )}
    </Popover>
  );
}
