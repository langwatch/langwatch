import "../../model/ambient.d.ts";
import { Box, Button, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import "./auth-front-door.css";
import { SHAPE } from "../../model/front-door-theme.ts";

/** Method button with icon, label, optional badge; shared shell for rail legibility. */
export function MethodButton({
  icon,
  label,
  badge,
  isBusy,
  onClick,
  testId,
}: {
  /** The provider's mark, or the ceremony's. Sits on the left rail. */
  icon: ReactNode;
  label: string;
  /** "Last used", where this browser remembers getting in this way. */
  badge?: ReactNode;
  isBusy?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      width="full"
      minHeight="44px"
      position="relative"
      fontSize="14px"
      fontWeight={600}
      borderRadius={SHAPE.action}
      justifyContent="center"
      overflow="visible"
      borderColor="frontDoor.fieldBorder"
      _hover={{
        backgroundColor: "frontDoor.fieldBg",
        borderColor: "fg.subtle",
      }}
      loading={isBusy}
      onClick={onClick}
      data-testid={testId}
    >
      <Box position="absolute" insetInlineStart="16px" display="flex">
        {icon}
      </Box>
      <Text>{label}</Text>
      {badge ? <span className="lw-front-door-badge-float">{badge}</span> : null}
    </Button>
  );
}
