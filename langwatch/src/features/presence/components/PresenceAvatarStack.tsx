import { HStack, Text } from "@chakra-ui/react";
import type { PresenceSession } from "~/server/app-layer/presence/types";
import { PresenceAvatar } from "./PresenceAvatar";

interface PresenceAvatarStackProps {
  sessions: PresenceSession[];
  max?: number;
  size?: "2xs" | "xs" | "sm" | "md";
}

/**
 * Renders a horizontally-stacked, slightly-overlapping cluster of presence
 * avatars, collapsing the tail into a "+N" badge once the count exceeds
 * {@link PresenceAvatarStackProps.max}.
 */
export function PresenceAvatarStack({
  sessions,
  max = 4,
  size = "2xs",
}: PresenceAvatarStackProps) {
  if (sessions.length === 0) return null;

  const visible = sessions.slice(0, max);
  const overflow = sessions.length - visible.length;

  return (
    <HStack gap={0} aria-label={`${sessions.length} viewers`}>
      {visible.map((session, idx) => (
        <PresenceAvatar
          key={session.sessionId}
          session={session}
          size={size}
          marginLeft={idx === 0 ? 0 : "-6px"}
          zIndex={visible.length - idx}
        />
      ))}
      {overflow > 0 ? (
        <Text
          textStyle="xs"
          color="fg.muted"
          marginLeft="6px"
          fontWeight="medium"
        >
          +{overflow}
        </Text>
      ) : null}
    </HStack>
  );
}
