import { Box } from "@langwatch/design-system/primitives";

/**
 * The unread count, like an email app, in one neutral colour: the count alone, never a
 * verdict, since the cards already say Act now or Check this. Draws nothing at zero.
 */
export function UnreadPill({ count, size = "sm" }: { count: number; size?: "sm" | "xs" }) {
  if (count <= 0) return null;
  return (
    <Box
      as="span"
      aria-label={`${count} unread`}
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      minWidth={size === "xs" ? "14px" : "18px"}
      height={size === "xs" ? "14px" : "16px"}
      paddingX={size === "xs" ? "3px" : "5px"}
      borderRadius="full"
      textStyle="micro"
      fontWeight="bold"
      fontVariantNumeric="tabular-nums"
      color="gray.contrast"
      background="gray.solid"
    >
      {count}
    </Box>
  );
}
