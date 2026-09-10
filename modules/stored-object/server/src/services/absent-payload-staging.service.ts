/**
 * The staging port on a deployment that composed no object storage. Named
 * rather than absent: a payload over the threshold refuses by name instead of
 * being posted inline into a 6 MB Lambda cap that fails opaquely.
 */
import { HandledError } from "@langwatch/handled-error";
import { PayloadStagingPort, type StagedPayload } from "#repositories/payload-staging.repository";

export class PayloadStagingUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super(
      "service_unavailable",
      "This request carries more data than can be sent inline, and this deployment has no object storage configured to stage it through.",
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "PayloadStagingUnavailableError";
  }
}

export class AbsentPayloadStagingAdapter extends PayloadStagingPort {
  static create(): AbsentPayloadStagingAdapter {
    return new AbsentPayloadStagingAdapter();
  }

  stage(): Promise<StagedPayload> {
    throw new PayloadStagingUnavailableError();
  }
}
