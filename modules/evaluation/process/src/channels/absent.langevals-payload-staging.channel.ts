import type { LangevalsPayloadStaging, StagedLangevalsPayload } from "./langevals.channel.ts";

/**
 * Staging until object storage signs a download (handoff §10): an
 * over-threshold payload refuses by name rather than posting into the cap.
 * Precedent: stored-object's `AbsentPayloadStagingAdapter`.
 */
export class AbsentLangevalsPayloadStaging implements LangevalsPayloadStaging {
  static create(): AbsentLangevalsPayloadStaging {
    return new AbsentLangevalsPayloadStaging();
  }

  private constructor() {}

  stage(input: { projectId: string }): Promise<StagedLangevalsPayload> {
    return Promise.reject(
      new Error(
        `project ${input.projectId}: a langevals payload over the staging threshold needs a presigned download, which this process's object storage does not offer`,
      ),
    );
  }
}
