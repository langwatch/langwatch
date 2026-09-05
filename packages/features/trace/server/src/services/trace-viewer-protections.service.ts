import type { CategoryVisibility, Protections } from "@langwatch/trace-contract";

export class TraceViewerProtectionsService {
  static create(): TraceViewerProtectionsService {
    return new TraceViewerProtectionsService();
  }

  /**
   * Whether this viewer may read text the model wrote FROM the conversation, as opposed to a fact about it. Both sides are required — a summary, title or evaluator's prose routinely paraphrases the prompt and reply together, so a viewer allowed only one could read the other out of it. The one place this rule is written down: every surface carrying such text (Sessions lens, Sessions screen, pull request detail, evaluator verdicts) asks here, so none can drift behind the others.
   */
  static canReadCapturedContent = (protections: Protections): boolean =>
    protections.canSeeCapturedInput === true && protections.canSeeCapturedOutput === true;
}
