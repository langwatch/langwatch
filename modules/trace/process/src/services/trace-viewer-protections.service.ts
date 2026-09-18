import type { Protections } from "@langwatch/trace-contract";

export class TraceViewerProtectionsService {
  static create(): TraceViewerProtectionsService {
    return new TraceViewerProtectionsService();
  }

  /**
   * Whether this viewer may read text the model wrote from the conversation, rather than a fact
   * about it. Both sides are required: summaries, titles and evaluator prose paraphrase prompt
   * and reply together, so one-sided access would leak the other. Every surface asks here.
   */
  static canReadCapturedContent = (protections: Protections): boolean =>
    protections.canSeeCapturedInput === true && protections.canSeeCapturedOutput === true;
}
