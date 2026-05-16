import { Box, chakra, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuChevronRight, LuUser } from "react-icons/lu";
import { getDisplayRoleVisuals, useIsScenarioRole } from "../scenarioRoles";
import { FlatTurnView } from "./FlatTurnView";
import { ROLE_COLORS, ROLE_ICONS, ROLE_LABELS } from "./RoleChip";
import { TurnView } from "./TurnView";
import { summarizeTurn } from "./turns";
import type { ChatLayout, ConversationTurn } from "./types";

/**
 * Collapsible Gmail-style turn row.
 *
 * - **Collapsed**: a single compact button showing role icon + label +
 *   summary, with a chevron on the right. No outer indentation, no
 *   thread line — turns sit flush in the container's own padding.
 * - **Expanded**: the turn's own `<TurnView>` body renders directly with
 *   no outer header chrome. The body's inner role header (system /
 *   user / assistant chip) gains a collapse chevron inline, so we never
 *   duplicate the role icon + label across an outer row and an inner
 *   row.
 */
export function ThreadedTurnView({
  turn,
  defaultExpanded,
  collapseTools = false,
  layout = "thread",
}: {
  turn: ConversationTurn;
  /**
   * Position of this turn in the surrounding list. Kept on the public
   * API for back-compat with callers; no longer used now that the
   * expanded state drops the outer "Turn N" header.
   */
  index?: number;
  /** Last-turn flag, kept for caller back-compat (no longer drives chrome). */
  isLast?: boolean;
  defaultExpanded: boolean;
  collapseTools?: boolean;
  /**
   * Which expanded body to render. "thread" → flat ChatGPT-style stack
   * (role chip on top, content below, no boxes). "bubbles" → the
   * canonical bubble/card UI from `TurnView`. The collapsed compact
   * row is identical for both — only the expanded body differs, so
   * users can flip between the two without losing the structure.
   */
  layout?: ChatLayout;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const summary = useMemo(() => summarizeTurn(turn), [turn]);
  const isScenario = useIsScenarioRole();

  // System / developer turns aren't role-swapped — only user/assistant get
  // remapped via the scenario helper. The colour token still keys off the
  // *display* role under scenario so the chip lines up with whatever
  // bubble/card body it sits next to.
  const sourceRole: string =
    turn.kind === "user"
      ? "user"
      : turn.kind === "assistant"
        ? "assistant"
        : turn.role;
  const scenarioVisuals =
    isScenario && (turn.kind === "user" || turn.kind === "assistant")
      ? getDisplayRoleVisuals(turn.kind, { isScenario: true })
      : null;
  const colorKey = scenarioVisuals?.displayRole ?? sourceRole;
  const color = ROLE_COLORS[colorKey] ?? "fg.muted";
  const RoleIcon = scenarioVisuals?.Icon ?? ROLE_ICONS[sourceRole] ?? LuUser;
  const label =
    scenarioVisuals?.label ??
    ROLE_LABELS[sourceRole] ??
    sourceRole.toUpperCase();

  if (expanded) {
    return (
      <Box paddingY={0.5}>
        {layout === "thread" ? (
          <FlatTurnView
            turn={turn}
            collapseTools={collapseTools}
            onCollapse={() => setExpanded(false)}
          />
        ) : (
          <TurnView
            turn={turn}
            collapseTools={collapseTools}
            onCollapse={() => setExpanded(false)}
          />
        )}
      </Box>
    );
  }

  return (
    <chakra.button
      type="button"
      onClick={() => setExpanded(true)}
      display="flex"
      alignItems="center"
      gap={1.5}
      paddingY={0.5}
      paddingX={1.5}
      borderRadius="sm"
      cursor="pointer"
      _hover={{ bg: "bg.muted" }}
      textAlign="left"
      width="full"
    >
      <HStack gap={1.5} flexShrink={0}>
        <Flex
          width="14px"
          height="14px"
          borderRadius="full"
          bg="bg.subtle"
          borderWidth="1px"
          borderColor="border.subtle"
          align="center"
          justify="center"
          flexShrink={0}
        >
          <Icon as={RoleIcon} boxSize="8px" color={color} />
        </Flex>
        <Text
          textStyle="2xs"
          color={color}
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.06em"
          lineHeight={1.4}
        >
          {label}
        </Text>
      </HStack>
      <Text
        textStyle="xs"
        color="fg.default"
        truncate
        flex={1}
        minWidth={0}
        lineHeight={1.4}
      >
        {summary}
      </Text>
      <Icon as={LuChevronRight} boxSize={2.5} color="fg.subtle" flexShrink={0} />
    </chakra.button>
  );
}
