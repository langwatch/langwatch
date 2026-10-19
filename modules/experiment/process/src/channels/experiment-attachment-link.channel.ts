/**
 * Reading an attachment from an address on the public internet.
 * @see specs/experiments-v3/attachment-inputs.feature
 */
import type { AttachmentBytes } from "../rules/attachment-parts.rules.ts";

export interface ExperimentAttachmentLinkChannel {
  /** The bytes at `url`, refused above `maxBytes` or, for an image column, when not a picture. */
  fetchAttachment(args: {
    url: string;
    columnType?: string;
    maxBytes: number;
  }): Promise<AttachmentBytes>;
}
