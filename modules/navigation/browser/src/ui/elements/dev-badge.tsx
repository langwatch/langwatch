import { Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

/** Wide enough for "DEV · " plus a typical worktree slug; a longer one truncates. */
const LABEL_MAX_WIDTH = "260px";

/**
 * The development pill in the top bar: "DEV", or "DEV · <slug>" when the
 * deployment names a haven stack. The tooltip says what it means in full.
 */
export function DevBadge({ label }: { label?: string }) {
  const tooltip = label ? `Development build, running the "${label}" stack` : "Development build";
  return (
    <Tooltip content={tooltip}>
      <Text
        textStyle="micro"
        fontWeight="bold"
        color="fg.onColor"
        backgroundColor="bg.devBadge"
        borderRadius="full"
        height="32px"
        lineHeight="32px"
        paddingX={3}
        maxWidth={LABEL_MAX_WIDTH}
        flexShrink={0}
        truncate
        // Focusable so keyboard readers reach the tooltip that holds a truncated slug.
        tabIndex={0}
        aria-label={tooltip}
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "colorPalette.focusRing",
          outlineOffset: "2px",
        }}
      >
        <Text as="span" letterSpacing="wider">
          DEV
        </Text>
        {label ? ` · ${label}` : null}
      </Text>
    </Tooltip>
  );
}
