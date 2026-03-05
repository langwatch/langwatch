/**
 * Context menu for suite sidebar items.
 * Shows Edit, Duplicate, and Archive actions.
 */

import { Box, Text, VStack } from "@chakra-ui/react";
import { useEffect, useRef } from "react";

type SuiteContextMenuProps = {
  x: number;
  y: number;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onClose: () => void;
};

export function SuiteContextMenu({
  x,
  y,
  onEdit,
  onDuplicate,
  onArchive,
  onClose,
}: SuiteContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <Box
      ref={ref}
      position="fixed"
      left={`${x}px`}
      top={`${y}px`}
      bg="bg.surface"
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      shadow="lg"
      zIndex={1000}
      py={1}
      minWidth="140px"
    >
      <VStack align="stretch" gap={0}>
        <ContextMenuItem label="Edit" onClick={() => { onEdit(); onClose(); }} />
        <ContextMenuItem label="Duplicate" onClick={() => { onDuplicate(); onClose(); }} />
        <ContextMenuItem
          label="Archive"
          onClick={() => { onArchive(); onClose(); }}
          color="orange.500"
        />
      </VStack>
    </Box>
  );
}

function ContextMenuItem({
  label,
  onClick,
  color,
}: {
  label: string;
  onClick: () => void;
  color?: string;
}) {
  return (
    <Box
      as="button"
      width="full"
      textAlign="left"
      paddingX={3}
      paddingY={1.5}
      cursor="pointer"
      _hover={{ bg: "bg.subtle" }}
      onClick={onClick}
    >
      <Text fontSize="sm" color={color}>
        {label}
      </Text>
    </Box>
  );
}
