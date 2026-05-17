import { Box, chakra, Flex, Icon, Text } from "@chakra-ui/react";
import { LuBot, LuChevronUp, LuUser } from "react-icons/lu";
import { getDisplayRoleVisuals, useIsScenarioRole } from "../scenarioRoles";
import { BlockStack } from "./BlockStack";
import {
  getRolePalette,
  ROLE_ICONS,
  ROLE_LABELS,
  type RolePalette,
} from "./RoleChip";
import type { ContentBlock, ConversationTurn } from "./types";

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
    const palette = getRolePalette(sourceRole);
    const label = ROLE_LABELS[sourceRole] ?? sourceRole.toUpperCase();
    return (
      <FlatBody
        Icon={RoleIcon}
        palette={palette}
        label={label}
        onCollapse={onCollapse}
      >
        {/* System prompts in thread layout render as plain text instead
            of the asMarkdownBody → fenced-code-block path used elsewhere.
            The latter detects pseudo-XML markers like `<role>`/`<goal>`
            and wraps the WHOLE message in a Shiki ```xml block, which
            then renders at 0.78em — visibly tiny vs neighbouring user
            and assistant turns. Plain `<pre>`-style rendering keeps the
            same baseline font size (textStyle="xs") as every other
            turn body. */}
        <SystemPlainText blocks={turn.blocks} />
      </FlatBody>
    );
  }

  const visuals = getDisplayRoleVisuals(turn.kind, { isScenario });
  // Key the palette on the *display* role so scenario role-swap lands
  // on the same colour the bubble layout uses (simulator = assistant
  // displayRole = purple, agent = user displayRole = blue).
  const sourceRole = turn.kind === "user" ? "user" : "assistant";
  const colorKey = visuals.displayRole ?? sourceRole;
  const palette = getRolePalette(colorKey);
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
      palette={palette}
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

/**
 * Plain-text renderer for system prompts in thread layout. Sidesteps
 * the markdown / code-fence pipeline so the operator sees the prompt
 * at the same size as every other turn. `whiteSpace="pre-wrap"`
 * preserves the original line breaks + indentation.
 */
function SystemPlainText({ blocks }: { blocks: ContentBlock[] }) {
  const text = blocks
    .filter(
      (b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text",
    )
    .map((b) => b.text)
    .join("\n");
  if (!text) {
    return (
      <Text textStyle="xs" color="fg.subtle" fontStyle="italic">
        No content
      </Text>
    );
  }
  return (
    <Box
      textStyle="xs"
      color="fg"
      lineHeight={1.6}
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      fontFamily="mono"
    >
      {text}
    </Box>
  );
}

function FlatBody({
  Icon: RoleIcon,
  palette,
  label,
  onCollapse,
  children,
}: {
  Icon: typeof LuUser;
  palette: RolePalette;
  label: string;
  onCollapse?: () => void;
  children: React.ReactNode;
}) {
  // Header always renders the same row chrome regardless of collapsed
  // state — operator complaint: "why when its not expanded the
  // system/agent/simulator/user header becomes smaller padded to the
  // middle?". Same padding + avatar size in both states. The whole
  // header is the click target when expanded (so clicking anywhere on
  // it collapses the turn), not just the chevron.
  return (
    <Box paddingY={1.5}>
      <chakra.button
        type="button"
        onClick={onCollapse}
        disabled={!onCollapse}
        display="flex"
        alignItems="center"
        gap={2}
        width="full"
        paddingY={0.5}
        paddingX={1.5}
        borderRadius="sm"
        cursor={onCollapse ? "pointer" : "default"}
        _hover={onCollapse ? { bg: "bg.muted" } : undefined}
        textAlign="left"
      >
        <Flex
          width="24px"
          height="24px"
          borderRadius="full"
          bg={palette.solid}
          align="center"
          justify="center"
          flexShrink={0}
        >
          <Icon as={RoleIcon} boxSize="13px" color={palette.contrast} />
        </Flex>
        <Text
          textStyle="2xs"
          color={palette.fg}
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
            {/* Caret direction matches operator spec:
                collapsed (expandable) → ↓, expanded (collapsible) → ↑.
                ThreadedTurnView's collapsed state shows ↓; here we're
                always rendering the expanded body, so always ↑. */}
            <Icon as={LuChevronUp} boxSize={3.5} color="fg.subtle" />
          </>
        )}
      </chakra.button>
      {/* Padding-left aligns the body with the role text, not the
          avatar circle. 32px ≈ 24px avatar + 8px gap. */}
      <Box paddingLeft="32px" paddingTop={1.5}>
        {children}
      </Box>
    </Box>
  );
}
