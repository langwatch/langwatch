import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { LuBot, LuUser } from "react-icons/lu";
import { getDisplayRoleVisuals, useIsScenarioRole } from "../scenarioRoles";
import { BlockStack } from "./BlockStack";
import { ROLE_COLORS, ROLE_ICONS, ROLE_LABELS } from "./RoleChip";
import { TurnCollapseChevron } from "./TurnCollapseChevron";
import type { ConversationTurn } from "./types";

/**
 * Flat, ChatGPT-style turn body. Renders the role chip on its own row
 * followed by the message content stacked below — no boxed cards, no
 * left accent borders, no right-aligned user bubble. Used as the
 * expanded body when the chat layout is "thread", so the threaded
 * view actually *looks* different from the bubble view (previously
 * both layouts shared the bubble/card UI underneath).
 */
export function FlatTurnView({
  turn,
  collapseTools = false,
  onCollapse,
}: {
  turn: ConversationTurn;
  collapseTools?: boolean;
  onCollapse?: () => void;
}) {
  const isScenario = useIsScenarioRole();

  if (turn.kind === "system") {
    const sourceRole = turn.role;
    const RoleIcon = ROLE_ICONS[sourceRole] ?? LuUser;
    const color = ROLE_COLORS[sourceRole] ?? "fg.muted";
    const label = ROLE_LABELS[sourceRole] ?? sourceRole.toUpperCase();
    return (
      <FlatBody
        Icon={RoleIcon}
        color={color}
        label={label}
        onCollapse={onCollapse}
      >
        <BlockStack
          blocks={turn.blocks}
          toolCalls={[]}
          collapseTools={collapseTools}
        />
      </FlatBody>
    );
  }

  const visuals = getDisplayRoleVisuals(turn.kind, { isScenario });
  // Same colour key resolution as ThreadedTurnView's collapsed header so
  // the chip carries through scenario role-swaps consistently.
  const sourceRole = turn.kind === "user" ? "user" : "assistant";
  const colorKey = visuals.displayRole ?? sourceRole;
  const color = ROLE_COLORS[colorKey] ?? "fg.muted";
  const RoleIcon =
    visuals.Icon ??
    ROLE_ICONS[sourceRole] ??
    (turn.kind === "user" ? LuUser : LuBot);
  const label =
    visuals.bubbleLabel ??
    ROLE_LABELS[sourceRole] ??
    sourceRole.toUpperCase();

  return (
    <FlatBody
      Icon={RoleIcon}
      color={color}
      label={label}
      onCollapse={onCollapse}
    >
      <BlockStack
        blocks={turn.blocks}
        toolCalls={turn.toolCalls}
        collapseTools={collapseTools}
      />
    </FlatBody>
  );
}

function FlatBody({
  Icon: RoleIcon,
  color,
  label,
  onCollapse,
  children,
}: {
  Icon: typeof LuUser;
  color: string;
  label: string;
  onCollapse?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Box paddingY={1.5}>
      <HStack gap={1.5} marginBottom={1.5}>
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
        {onCollapse && (
          <>
            <Box flex={1} />
            <TurnCollapseChevron onClick={onCollapse} />
          </>
        )}
      </HStack>
      <Box paddingLeft="20px">{children}</Box>
    </Box>
  );
}
