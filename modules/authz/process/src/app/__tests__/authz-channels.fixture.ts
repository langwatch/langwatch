import { BRAIDS_FLAG } from "@langwatch/authz-contract";

import { MemoryAuthzChannels } from "../../channels/memory/memory.authz.channels.ts";

/** The memory channels an app is composed over; braids are managed only once released. */
export function memoryAuthzChannels({ braidsReleased = false }: { braidsReleased?: boolean } = {}) {
  const channels = MemoryAuthzChannels.create();
  if (braidsReleased) channels.flags.release({ flag: BRAIDS_FLAG });
  return channels;
}
