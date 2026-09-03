/**
 * The message a live run is waiting for, drawn where it will land.
 *
 * Three dots move in the bubble of whoever speaks next, so a run between two
 * messages reads as one still being written rather than one that stopped. It
 * is drawn only when the next message is known: while the judge reads the
 * conversation the drawer shows nothing, because the run may already be over.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 */

import { Box, Circle, Flex, HStack, Icon } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { getDisplayRoleVisuals } from "@langwatch/trace-web/scenario-role";
import { BUBBLE_TONES } from "@langwatch/trace-web/explorer/components/TraceTable/registry/addons/conversation/Bubble";

/** One dot rises and fades, the next follows it. */
const typingDot = keyframes`
  0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-2px); }
`;

const DOT_DELAYS_MS = [0, 160, 320];

export type TypingBubbleProps = {
  /** The role of the message being waited for, as the run stores it. */
  role: "user" | "assistant";
  size?: "compact" | "regular";
};

export function TypingBubble({ role, size = "regular" }: TypingBubbleProps) {
  const visuals = getDisplayRoleVisuals(role, { isScenario: true });
  const palette = BUBBLE_TONES[visuals.displayRole];
  const side = visuals.displayRole === "user" ? "left" : "right";
  const RoleIcon = visuals.Icon;
  const compact = size === "compact";

  return (
    <Flex
      align="center"
      gap={2}
      flexDirection={side === "right" ? "row-reverse" : "row"}
      width="full"
      data-testid="conversation-typing"
      data-typing-role={role}
      aria-label={`${visuals.bubbleLabel} is writing`}
    >
      <Circle
        size={compact ? "22px" : "26px"}
        bg={palette.avatarBg}
        color={palette.avatarFg}
        flexShrink={0}
      >
        <Icon boxSize={compact ? "12px" : "14px"}>
          <RoleIcon />
        </Icon>
      </Circle>

      <HStack
        gap={1}
        bg={palette.bg}
        color={palette.fg}
        paddingX={compact ? 3.5 : 4}
        paddingY={compact ? 2.5 : 3}
        borderRadius="2xl"
        borderTopLeftRadius={side === "left" ? "sm" : "2xl"}
        borderTopRightRadius={side === "right" ? "sm" : "2xl"}
      >
        {DOT_DELAYS_MS.map((delay) => (
          <Box
            key={delay}
            boxSize="5px"
            borderRadius="full"
            background="currentColor"
            css={{
              animation: `${typingDot} 1.2s ease-in-out infinite`,
              animationDelay: `${delay}ms`,
            }}
          />
        ))}
      </HStack>
    </Flex>
  );
}
