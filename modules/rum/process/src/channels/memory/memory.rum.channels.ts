import type { RumConfig } from "@langwatch/rum-contract";
import type { ScopedSecrets } from "@langwatch/secrets";

import { HttpRumChannels } from "../http/http.rum.channels.ts";
import type { RumChannels } from "../rum.channels.ts";

/** Forwards through the live fence, as before the registry, so a stubbed fetch sees the request. */
export class MemoryRumChannels {
  static readonly requires = [] as const;

  static create(input: { config: RumConfig; secrets: ScopedSecrets }): Promise<RumChannels> {
    return HttpRumChannels.create(input);
  }
}
