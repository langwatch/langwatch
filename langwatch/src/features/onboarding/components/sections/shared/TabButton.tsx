import { Button } from "@chakra-ui/react";
import type React from "react";

export function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      borderRadius="lg"
      px={5}
      py={1.5}
      fontSize="sm"
      fontWeight={active ? "semibold" : "medium"}
      color={active ? "fg.DEFAULT" : "fg.muted"}
      bg={active ? "white" : "transparent"}
      backdropFilter={active ? "blur(20px) saturate(1.3)" : undefined}
      boxShadow={
        active
          ? "0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 white"
          : undefined
      }
      border="1px solid"
      borderColor={active ? "gray.200" : "transparent"}
      transition="all 0.17s ease"
      _hover={{ bg: active ? "white" : "gray.50" }}
      letterSpacing="-0.01em"
    >
      {label}
    </Button>
  );
}
