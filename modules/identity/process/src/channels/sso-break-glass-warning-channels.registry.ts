import { MemorySsoBreakGlassWarningChannel } from "./memory/memory.sso-break-glass-warning.channel.ts";
import { LoggedSsoBreakGlassWarningChannel } from "./sso-break-glass-warning.channel.ts";

export const ssoBreakGlassWarningChannels = {
  live: LoggedSsoBreakGlassWarningChannel,
  memory: MemorySsoBreakGlassWarningChannel,
};
