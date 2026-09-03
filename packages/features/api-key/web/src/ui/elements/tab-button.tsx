/**
 * One tab in the token dialog's two tab rows.
 *
 * A FAMILY-LOCAL COPY of
 * `platform/app/src/features/onboarding/components/sections/shared/TabButton.tsx`,
 * which stays: two other onboarding surfaces render it and the deletes-only
 * ruling forbids repointing them. Thirty-nine lines of Chakra props with no
 * behaviour, so the copy is the whole component rather than a narrowing.
 */

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
      color={active ? { base: "black", _dark: "white" } : "fg.muted"}
      bg={active ? "bg.panel" : "transparent"}
      backdropFilter={active ? "blur(20px) saturate(1.3)" : undefined}
      boxShadow={active ? "0 2px 8px rgba(0,0,0,0.06)" : undefined}
      border="1px solid"
      borderColor={active ? { base: "orange.200", _dark: "orange.800" } : "transparent"}
      transition="all 0.17s ease"
      _hover={{
        bg: active ? "bg.panel" : "bg.muted",
        color: active ? { base: "black", _dark: "white" } : "orange.500",
      }}
      letterSpacing="-0.01em"
    >
      {label}
    </Button>
  );
}
