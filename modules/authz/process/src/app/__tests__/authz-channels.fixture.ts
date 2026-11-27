import { BRAIDS_FLAG } from "@langwatch/authz-contract";

import { MemoryAuthzChannels } from "../../channels/memory/memory.authz.channels.ts";

/** The memory channels an app is composed over; braids are managed only where released. */
export function memoryAuthzChannels({
  braidsReleasedFor = [],
}: { braidsReleasedFor?: readonly string[] } = {}) {
  const channels = MemoryAuthzChannels.create();
  for (const organizationId of braidsReleasedFor) {
    channels.flags.release({ flag: BRAIDS_FLAG, organizationId });
  }
  return channels;
}
