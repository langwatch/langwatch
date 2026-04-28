import { Avatar, Box, type AvatarRootProps } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";
import type { PresenceSession } from "~/server/app-layer/presence/types";
import {
  presenceDisplayName,
  presenceSessionColor,
} from "../utils/sessionColor";

interface PresenceAvatarProps extends Omit<AvatarRootProps, "size"> {
  session: PresenceSession;
  size?: AvatarRootProps["size"];
  showTooltip?: boolean;
}

export function PresenceAvatar({
  session,
  size = "2xs",
  showTooltip = true,
  ...rootProps
}: PresenceAvatarProps) {
  const displayName = presenceDisplayName(session);
  const color = presenceSessionColor(session);

  const avatar = (
    <Avatar.Root
      size={size}
      background={color}
      color="white"
      borderWidth="2px"
      borderColor="bg.surface"
      {...rootProps}
    >
      {session.user.image ? <Avatar.Image src={session.user.image} /> : null}
      <Avatar.Fallback name={displayName} />
    </Avatar.Root>
  );

  if (!showTooltip) return avatar;

  return (
    <Tooltip content={describePresence(session, displayName)} positioning={{ placement: "top" }}>
      <Box display="inline-flex">{avatar}</Box>
    </Tooltip>
  );
}

function describePresence(
  session: PresenceSession,
  displayName: string,
): string {
  const parts: string[] = [displayName];
  const { route, view } = session.location;

  if (route.traceId) {
    parts.push(`trace ${shortId(route.traceId)}`);
  } else if (route.conversationId) {
    parts.push(`conversation ${shortId(route.conversationId)}`);
  } else {
    parts.push(`browsing ${session.location.lens}`);
  }

  if (view?.mode && view.mode !== "trace") parts.push(view.mode);
  if (view?.panel) parts.push(view.panel);
  if (view?.tab) parts.push(view.tab);

  return parts.join(" · ");
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
