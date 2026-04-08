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
      color={active ? "orange.500" : "fg.muted"}
      bg={active ? "bg.panel" : "transparent"}
      backdropFilter={active ? "blur(20px) saturate(1.3)" : undefined}
      boxShadow={
        active
          ? "0 2px 8px rgba(0,0,0,0.06)"
          : undefined
      }
      border="1px solid"
      borderColor={active ? { base: "orange.200", _dark: "orange.800" } : "transparent"}
      transition="all 0.17s ease"
      _hover={{ bg: active ? "bg.panel" : "bg.muted" }}
      letterSpacing="-0.01em"
    >
      {label}
    </Button>
  );
}
