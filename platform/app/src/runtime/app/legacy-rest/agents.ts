import { LegacyAgentsRestApi } from "@langwatch/agents-server/legacy-rest";
import type { AgentsRuntimeContext } from "../features/agents";
import { AgentsFeature } from "../features/agents";

export class LegacyAgentsRestFeature {
  static create(context: AgentsRuntimeContext): LegacyAgentsRestApi {
    return LegacyAgentsRestApi.create(AgentsFeature.create(context));
  }
}
