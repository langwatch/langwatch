/**
 * Turns the attachment references a row carries into bytes: neither the engine
 * nor an agent can authenticate to the deployment that serves a reference.
 * @see specs/experiments-v3/dataset-attachments.feature
 */

import { parseDatasetAttachmentReference } from "@langwatch/dataset-contract";
import type { ExperimentAttachmentPort } from "../ports/experiment-attachment.port.ts";

export class ExperimentAttachmentInliningService {
  static create({
    attachments,
  }: {
    attachments: ExperimentAttachmentPort;
  }): ExperimentAttachmentInliningService {
    return new ExperimentAttachmentInliningService(attachments);
  }

  private constructor(private readonly attachments: ExperimentAttachmentPort) {}

  /**
   * The inputs with every stored attachment reference among `fields` replaced by
   * its bytes as a data URL. Every other value, and every reference this run may
   * not read, is returned exactly as it arrived.
   */
  async inlineInputs({
    projectId,
    inputs,
    fields,
  }: {
    projectId: string;
    inputs: Record<string, unknown>;
    fields: readonly string[];
  }): Promise<Record<string, unknown>> {
    if (fields.length === 0) {
      return inputs;
    }

    let inlined = inputs;
    for (const field of fields) {
      const reference = parseDatasetAttachmentReference(inputs[field]);
      // The project comes from the run, never from the cell: a reference pasted
      // from another project is not this run's to read.
      if (!reference || reference.projectId !== projectId) {
        continue;
      }

      const read = await this.attachments.tryRead({ projectId, id: reference.id });
      if (!read) {
        continue;
      }

      if (inlined === inputs) {
        inlined = { ...inputs };
      }

      inlined[field] = `data:${read.mediaType};base64,${read.bytes.toString("base64")}`;
    }

    return inlined;
  }
}
