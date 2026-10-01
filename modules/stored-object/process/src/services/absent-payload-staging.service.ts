/**
 * The staging port on a deployment that composed no object storage. Named
 * rather than absent: a payload over the threshold refuses by name instead of
 * being posted inline into a 6 MB Lambda cap that fails opaquely.
 */
import { PayloadStagingUnavailableError } from "@langwatch/stored-object-contract";

import {
  PayloadStagingRepository,
  type StagedPayload,
} from "#repositories/payload-staging.repository";

export class AbsentPayloadStagingService extends PayloadStagingRepository {
  static create(): AbsentPayloadStagingService {
    return new AbsentPayloadStagingService();
  }

  private constructor() {
    super();
  }

  stage(): Promise<StagedPayload> {
    throw new PayloadStagingUnavailableError();
  }
}
