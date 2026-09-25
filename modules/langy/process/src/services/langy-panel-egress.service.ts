import type {
  LangyEgressAllowlist,
  LangyPanelCall,
  langyEgressGetInputSchema,
  langyEgressSetInputSchema,
  langyEgressStateSchema,
} from "@langwatch/langy-contract";
import type { z } from "zod";

import type { LangyPanelAccessService } from "./langy-panel-access.service.ts";
import type { LangyService } from "./langy.service.ts";

type EgressState = z.infer<typeof langyEgressStateSchema>;

/**
 * The project's egress allow-list as the settings editor reads and replaces it. An unset list
 * is monitor-only: watch, never block. Spec: specs/langy/langy-egress-enforcement.feature
 */
export class LangyPanelEgressService {
  static create(members: {
    access: LangyPanelAccessService;
    langy: Pick<LangyService, "findEgressAllowlist" | "setEgressAllowlist">;
  }): LangyPanelEgressService {
    return new LangyPanelEgressService(members.access, members.langy);
  }

  private constructor(
    private readonly access: LangyPanelAccessService,
    private readonly langy: Pick<LangyService, "findEgressAllowlist" | "setEgressAllowlist">,
  ) {}

  async getEgressState(
    input: LangyPanelCall<typeof langyEgressGetInputSchema>,
  ): Promise<EgressState> {
    await this.access.assertPanelAccess(input);
    return toEgressState(await this.langy.findEgressAllowlist({ projectId: input.projectId }));
  }

  /** An empty list clears the allow-list back to monitor-only. */
  async setEgressState(
    input: LangyPanelCall<typeof langyEgressSetInputSchema>,
  ): Promise<EgressState> {
    await this.access.assertPanelAccess(input);
    const saved = await this.langy.setEgressAllowlist({
      projectId: input.projectId,
      allowlist: input.allowlist,
    });
    return toEgressState(saved.length > 0 ? saved : null);
  }
}

function toEgressState(allowlist: LangyEgressAllowlist | null): EgressState {
  return { allowlist: allowlist ?? [], enforcing: allowlist !== null };
}
