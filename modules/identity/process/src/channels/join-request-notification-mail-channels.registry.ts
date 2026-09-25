import { MemoryJoinRequestNotificationMailChannel } from "./memory/memory.join-request-notification-mail.channel.ts";
import { SesJoinRequestNotificationMailChannel } from "./ses/ses.join-request-notification-mail.channel.ts";

export const joinRequestNotificationMailChannels = {
  ses: SesJoinRequestNotificationMailChannel,
  memory: MemoryJoinRequestNotificationMailChannel,
};
