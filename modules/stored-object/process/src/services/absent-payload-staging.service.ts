/**
 * The staging port on a deployment that composed no object storage. Named
 * rather than absent: a payload over the threshold refuses by name instead of
 * being posted inline into a 6 MB Lambda cap that fails opaquely.
 */
import { PayloadStagingUnavailableError } from "@langwatch/stored-object-contract";
import { PayloadStaging, type StagedPayload } from "#repositories/payload-staging.repository";

export class AbsentPayloadStagingAdapter extends PayloadStaging {
  static create(): AbsentPayloadStagingAdapter {
    return new AbsentPayloadStagingAdapter();
  }

  stage(): Promise<StagedPayload> {
    throw new PayloadStagingUnavailableError();
  }
}
