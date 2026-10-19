import { HttpExperimentAttachmentLinkChannel } from "./http/http.experiment-attachment-link.channel.ts";
import { MemoryExperimentAttachmentLinkChannel } from "./memory/memory.experiment-attachment-link.channel.ts";

/** The two tiers behind `ExperimentAttachmentLinkChannel`. */
export const experimentAttachmentLinkChannels = {
  http: HttpExperimentAttachmentLinkChannel,
  memory: MemoryExperimentAttachmentLinkChannel,
};
