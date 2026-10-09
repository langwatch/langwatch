import { Box } from "@langwatch/design-system/primitives";

/**
 * The unread count, like an email app: green when the unseen news skews good, red when it
 * skews bad. Draws nothing at zero.
 */
export function UnreadPill({
  count,
  tone,
  size = "sm",
}: {
  count: number;
  tone: "good" | "bad";
  size?: "sm" | "xs";
}) {
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
      fontSize={size === "xs" ? "8px" : "9.5px"}
      fontWeight="bold"
      fontVariantNumeric="tabular-nums"
      color="white"
      background={tone === "good" ? "green.solid" : "red.solid"}
    >
      {count}
    </Box>
  );
}
