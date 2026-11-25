/**
 * A resource as a clickable tile (workflows, agents, evaluators, role cards). WorkflowCard
 * generalised: the opener is the caller's native link or button, stretched under the tile's
 * menu and badges so they stay clickable. Only for tiles that open something.
 */
import { Box, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { cloneElement, type ReactElement, type ReactNode } from "react";

interface OpenerProps {
  "aria-label"?: string;
  type?: "button" | "submit" | "reset";
}

export interface ResourceTileProps {
  icon: ReactNode;
  title: string;
  /** Two lines, clamped. */
  description?: string;
  /** "Updated 3 days ago", counts. */
  meta?: ReactNode;
  badges?: ReactNode;
  /** The row-actions overflow menu, top right. */
  menu?: ReactNode;
  /**
   * The native `<a>` or `<button>` that opens it, or a link component that renders one; named by
   * `title` unless it has a label. A bare `<button>` is given `type="button"`; any other native
   * element is refused.
   */
  opener: ReactElement<OpenerProps>;
  /** Paint only (a fill and border): a tile that picks one of several is a RadioCard. */
  selected?: boolean;
  "data-testid"?: string;
}

/** The meta row lets clicks fall through to the opener; a control inside it takes its own. */
const BADGE_CONTROLS = {
  "& a, & button, & input, & select, & textarea, & [role=button], & [role=link]": {
    pointerEvents: "auto",
  },
} as const;

const OPENER = {
  "& > [data-tile-opener] > a, & > [data-tile-opener] > button": {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    borderRadius: "xl",
    cursor: "pointer",
    _focusVisible: { outline: "2px solid", outlineColor: "blue.focusRing" },
  },
} as const;

export function ResourceTile({
  icon,
  title,
  description,
  meta,
  badges,
  menu,
  opener,
  selected = false,
  "data-testid": testId,
}: ResourceTileProps) {
  const native = opener.type;
  if (typeof native === "string" && native !== "a" && native !== "button") {
    throw new Error(`ResourceTile: the opener must be a link or a button, not <${native}>`);
  }
  const buttonType = native === "button" && opener.props.type === void 0 ? "button" : void 0;
  return (
    <VStack
      align="stretch"
      position="relative"
      padding={4}
      gap={2}
      minHeight="142px"
      borderRadius="xl"
      background={selected ? "bg.selected" : "bg.card"}
      borderWidth="1px"
      borderColor={selected ? "border.emphasized" : "border.muted"}
      boxShadow="md"
      transition="box-shadow 0.2s ease-in-out"
      _hover={{ boxShadow: "xl" }}
      css={OPENER}
      data-selected={selected ? "true" : undefined}
      data-testid={testId}
    >
      <Box data-tile-opener="">
        {cloneElement(opener, {
          "aria-label": opener.props["aria-label"] ?? title,
          type: buttonType ?? opener.props.type,
        })}
      </Box>
      <HStack gap={3} align="start">
        <Box color="fg" display="flex" flexShrink={0}>
          {icon}
        </Box>
        <Spacer />
        {menu != null && (
          <Box position="relative" zIndex={2}>
            {menu}
          </Box>
        )}
      </HStack>
      <Spacer />
      <Text textStyle="sm" fontWeight="medium" color="fg" truncate>
        {title}
      </Text>
      {description && (
        <Text textStyle="sm" color="fg.muted" lineClamp={2}>
          {description}
        </Text>
      )}
      {(meta != null || badges != null) && (
        <HStack
          gap={2}
          flexWrap="wrap"
          position="relative"
          zIndex={2}
          pointerEvents="none"
          css={BADGE_CONTROLS}
        >
          {meta != null && (
            <Text textStyle="caption" color="fg.subtle">
              {meta}
            </Text>
          )}
          {badges}
        </HStack>
      )}
    </VStack>
  );
}
