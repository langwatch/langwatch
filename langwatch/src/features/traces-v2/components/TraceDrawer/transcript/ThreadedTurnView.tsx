import { Box, chakra, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight, LuUser } from "react-icons/lu";
import { getDisplayRoleVisuals, useIsScenarioRole } from "../scenarioRoles";
import { ROLE_COLORS, ROLE_ICONS, ROLE_LABELS } from "./RoleChip";
import { TurnView } from "./TurnView";
import { summarizeTurn } from "./turns";
import type { ConversationTurn } from "./types";

/**
 * Collapsible Gmail-style turn row. Header shows role + summary; body
 * expands to the full TurnView. Continuous thread line on the left.
 */
export function ThreadedTurnView({
  turn,
  index,
  isLast,
  defaultExpanded,
  collapseTools = false,
}: {
  turn: ConversationTurn;
  index: number;
  isLast: boolean;
  defaultExpanded: boolean;
  collapseTools?: boolean;
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

  return (
    <Box position="relative" paddingLeft={6} paddingY={0}>
      {!isLast && (
        <Box
          position="absolute"
          left="7px"
          top="22px"
          bottom={0}
          width="1px"
          bg="border.muted"
        />
      )}
      {/* A neutral chip with a colored icon — keeps the role signal but
          drops the loud colored fill that was competing with the row text. */}
      <Flex
        position="absolute"
        left={0}
        top="6px"
        width="14px"
        height="14px"
        borderRadius="full"
        bg="bg.subtle"
        borderWidth="1px"
        borderColor="border.subtle"
        align="center"
        justify="center"
        flexShrink={0}
        zIndex={1}
      >
        <Icon as={RoleIcon} boxSize="8px" color={color} />
      </Flex>

      <chakra.button
        type="button"
        onClick={() => setExpanded((v) => !v)}
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
        <Text
          textStyle="2xs"
          color={color}
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.06em"
          flexShrink={0}
          lineHeight={1.4}
        >
          {label}
        </Text>
        <Text
          textStyle="xs"
          color={expanded ? "fg.muted" : "fg.default"}
          truncate
          flex={1}
          minWidth={0}
          fontStyle={expanded ? "italic" : "normal"}
          lineHeight={1.4}
        >
          {expanded ? `Turn ${index + 1}` : summary}
        </Text>
        <Icon
          as={expanded ? LuChevronDown : LuChevronRight}
          boxSize={2.5}
          color="fg.subtle"
          flexShrink={0}
        />
      </chakra.button>

      {expanded && (
        <Box paddingTop={1} paddingBottom={2}>
          <TurnView turn={turn} collapseTools={collapseTools} />
        </Box>
      )}
    </Box>
  );
}
