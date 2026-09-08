import { createLogger } from "@langwatch/observability";
import { ExperimentAttachmentPort } from "../ports/experiment-attachment.port.ts";

const logger = createLogger("langwatch:experiment:run-orchestrator");

/**
 * The attachment read on a deployment that composed no object store. Every
 * reference stays the text the cell holds, said once rather than per cell.
 */
export class UnavailableExperimentAttachmentAdapter extends ExperimentAttachmentPort {
  static create(): UnavailableExperimentAttachmentAdapter {
    return new UnavailableExperimentAttachmentAdapter();
  }

  private reported = false;

  async tryRead(_input: { projectId: string; id: string }): Promise<null> {
    if (!this.reported) {
      this.reported = true;
      logger.warn(
        {},
        "Uploaded dataset attachments are not inlined: this deployment composed no object store",
      );
    }

    return null;
  }
}
