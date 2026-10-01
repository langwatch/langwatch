import { Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

/** Wide enough for a typical worktree slug; a longer one truncates. */
const LABEL_MAX_WIDTH = "220px";

/**
 * The development pill in the top bar: "DEV", or the haven stack's slug when
 * the deployment names one. A long slug truncates; the tooltip holds it whole.
 */
export function DevBadge({ label }: { label?: string }) {
  const pill = (
    <Text
      fontSize="11px"
      fontWeight="bold"
      color="white"
      backgroundColor="blackAlpha.600"
      border="1px solid"
      borderColor="whiteAlpha.300"
      borderRadius="full"
      height="32px"
      lineHeight="30px"
      paddingX={3}
      maxWidth={LABEL_MAX_WIDTH}
      flexShrink={0}
      truncate
      letterSpacing={label ? "normal" : "wider"}
    >
      {label ?? "DEV"}
    </Text>
  );
  if (!label) return pill;
  return <Tooltip content={label}>{pill}</Tooltip>;
}
