import {
  attachmentDisplayName,
  DatasetAttachmentUnavailableError,
} from "@langwatch/dataset-contract";

import type { AttachmentBytes } from "../../rules/attachment-parts.rules.ts";
import type { ExperimentAttachmentLinkChannel } from "../experiment-attachment-link.channel.ts";

/** Addresses in memory: a seeded url answers its bytes, any other is unavailable. */
export class MemoryExperimentAttachmentLinkChannel implements ExperimentAttachmentLinkChannel {
  readonly asked: { url: string; columnType?: string }[] = [];
  private readonly answers = new Map<string, AttachmentBytes>();

  private constructor() {}

  static create(): MemoryExperimentAttachmentLinkChannel {
    return new MemoryExperimentAttachmentLinkChannel();
  }

  seed({ url, attachment }: { url: string; attachment: AttachmentBytes }): void {
    this.answers.set(url, attachment);
  }

  async fetchAttachment(args: { url: string; columnType?: string }): Promise<AttachmentBytes> {
    this.asked.push(args);
    const found = this.answers.get(args.url);
    if (!found) throw new DatasetAttachmentUnavailableError(attachmentDisplayName(args.url));

    return found;
  }
}
