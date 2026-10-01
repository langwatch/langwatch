import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { MemoryExperimentAttachmentLinkChannel } from "../../channels/memory/memory.experiment-attachment-link.channel.ts";
import { ExperimentAttachmentInputService } from "../experiment-attachment-input.service.ts";

/** For a run whose rows carry no image or file: reading one throws by name. */
export function createNoAttachmentsFixture(): ExperimentAttachmentInputService {
  return ExperimentAttachmentInputService.create({
    storedObjects: createApiFixture<StoredObjectApi>({}, "storedObjects"),
    links: MemoryExperimentAttachmentLinkChannel.create(),
  });
}
