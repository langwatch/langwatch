import type { AgentApi } from "@langwatch/agent-contract";

import type { AgentOwnerNameReader } from "./connected-target.service.ts";

/** Owner names read through the agent module's own `ownersOf`. */
export class AgentOwnerNamesService implements AgentOwnerNameReader {
  static create(agents: Pick<AgentApi, "ownersOf">): AgentOwnerNamesService {
    return new AgentOwnerNamesService(agents);
  }

  private constructor(private readonly agents: Pick<AgentApi, "ownersOf">) {}

  async findNamesByIds(ids: readonly string[]): Promise<Map<string, string | null>> {
    const owners = await this.agents.ownersOf(ids.map((ownerUserId) => ({ ownerUserId })));
    return new Map([...owners].map(([id, owner]) => [id, owner.name]));
  }
}
