import { Box, Button, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import "../authFrontDoor.css";
import { SHAPE } from "../logic/brand";

/**
 * One seat in the rail of ways in.
 *
 * Every method on the front door — a provider hand-off, a passkey ceremony —
 * is the same offer said with a different mark, so it is the same button.
 * Three fixed seats: the mark on the left rail, the words centred, the badge
 * (if any) floated on the right. A label centres on the same axis whatever
 * sits beside it, which is what lets the rail read as one column of choices
 * rather than a stack of separately-styled buttons.
 *
 * The shell is shared rather than copied because the rail is only legible
 * while the seats agree. A passkey button that centred its own icon-and-label
 * pair, at the field radius instead of the action one, was visibly a
 * different kind of thing sitting under three that matched.
 */
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
      borderColor="var(--lw-front-door-field-border)"
      _hover={{
        backgroundColor: "var(--lw-front-door-field-bg)",
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
      {badge ? (
        <span className="lw-front-door-badge-float">{badge}</span>
      ) : null}
    </Button>
  );
}
