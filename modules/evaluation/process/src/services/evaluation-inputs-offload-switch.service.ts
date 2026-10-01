import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";

import type { EvaluationInputsOffload } from "../app/evaluation.members.ts";

/** Offloads oversized inputs unless the operator switched offloading off; then they stay inline. */
export class FlaggedEvaluationInputsOffloadService implements EvaluationInputsOffload {
  static create(input: {
    inputs: EvaluationInputsOffload;
    flags: Pick<FeatureFlagApi, "isEnabled">;
  }): FlaggedEvaluationInputsOffloadService {
    return new FlaggedEvaluationInputsOffloadService(input.inputs, input.flags);
  }

  private constructor(
    private readonly inputs: EvaluationInputsOffload,
    private readonly flags: Pick<FeatureFlagApi, "isEnabled">,
  ) {}

  async offload(input: {
    tenantId: string;
    evaluationId: string;
    inputs: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const disabled = await this.flags.isEnabled("ops_evaluation_payload_offload_disabled", {
      kind: "system",
    });

    return disabled ? input.inputs : this.inputs.offload(input);
  }
}
