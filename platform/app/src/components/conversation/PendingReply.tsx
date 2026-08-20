/**
 * The reply that has been asked for and has not started arriving.
 *
 * A model takes a beat before its first token — longer with a slow provider, a
 * cold cache or a long prompt — and until now that beat drew nothing at all.
 * The send button went quiet and the thread stayed exactly as it was, which
 * reads as the message not having been sent rather than as an answer on its
 * way.
 *
 * Shaped like the reply it precedes: the assistant's avatar and bubble, in the
 * assistant's place in the thread, so the answer lands where the waiting state
 * already is instead of appearing somewhere new. The word shimmers the way
 * thinking text does elsewhere in the product, rather than animating a row of
 * dots beside it — one moving thing, and it is the word that says what is
 * happening.
 */
import { Box, Circle, Flex, Icon } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";

import { getDisplayRoleVisuals } from "~/features/traces-v2/components/TraceDrawer/scenarioRoles";

const shimmer = keyframes`
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
`;

/** The same sweep the trace drawer uses for a model's thinking. */
function ShimmerText({ children }: { children: string }) {
  return (
    <Box
      as="span"
      // Named explicitly rather than through `currentColor`: the text itself
      // has to be transparent for `background-clip: text` to show the sweep,
      // and `currentColor` inside the gradient would resolve to that same
      // transparent value — a gradient of nothing, clipped to the glyphs.
      backgroundImage={`linear-gradient(
        100deg,
        var(--chakra-colors-fg-subtle) 0%,
        var(--chakra-colors-fg-subtle) 38%,
        var(--chakra-colors-fg) 50%,
        var(--chakra-colors-fg-subtle) 62%,
        var(--chakra-colors-fg-subtle) 100%
      )`}
      backgroundSize="220% 100%"
      backgroundRepeat="no-repeat"
      backgroundClip="text"
      animation={`${shimmer} 2.4s linear infinite`}
      css={{
        WebkitBackgroundClip: "text",
        color: "transparent !important",
        // Reduced motion keeps the word and drops the sweep: what it says is
        // the information, the movement is only the reminder.
        "@media (prefers-reduced-motion: reduce)": {
          animation: "none",
          backgroundImage: "none",
          color: "var(--chakra-colors-fg-muted) !important",
        },
      }}
    >
      {children}
    </Box>
  );
}

export function PendingReply({
  compact = false,
  roleMode = "chat",
}: {
  compact?: boolean;
  roleMode?: "chat" | "scenario";
}) {
  const visuals = getDisplayRoleVisuals("assistant", {
    isScenario: roleMode === "scenario",
  });
  const RoleIcon = visuals.Icon;
  const side = visuals.displayRole === "user" ? "left" : "right";

  return (
    <Flex
      align="flex-start"
      gap={2}
      width="full"
      flexDirection={side === "right" ? "row-reverse" : "row"}
      // Named for the reader, not for the shape: assistive technology should
      // announce that a reply is coming, not describe an animation.
      role="status"
      aria-live="polite"
    >
      <Circle
        size={compact ? "22px" : "26px"}
        bg="purple.muted"
        color="purple.fg"
        flexShrink={0}
      >
        <Icon boxSize={compact ? "12px" : "14px"}>
          <RoleIcon />
        </Icon>
      </Circle>

      {/* Same bubble geometry the reply itself will take — radius, padding and
          the clipped corner on the avatar's side — so the answer replaces the
          waiting state in place rather than jumping out of it. */}
      <Box
        bg="bg.muted"
        paddingX={compact ? 3.5 : 4}
        paddingY={compact ? 2.5 : 3}
        borderRadius="2xl"
        borderTopLeftRadius={side === "left" ? "sm" : "2xl"}
        borderTopRightRadius={side === "right" ? "sm" : "2xl"}
        fontSize={compact ? "xs" : "sm"}
        lineHeight="1.55"
      >
        <ShimmerText>Thinking</ShimmerText>
      </Box>
    </Flex>
  );
}
