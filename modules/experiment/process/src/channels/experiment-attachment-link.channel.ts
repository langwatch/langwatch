/**
 * Reading an attachment from an address on the public internet.
 * @see specs/experiments-v3/attachment-inputs.feature
 */
import type { AttachmentBytes } from "../rules/attachment-parts.rules.ts";

export interface ExperimentAttachmentLinkChannel {
  /** The bytes at `url`, refused when too large or, for an image column, not a picture. */
  fetchAttachment(args: { url: string; columnType?: string }): Promise<AttachmentBytes>;
}
