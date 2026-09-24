/**
 * Attachments a row carries into the target it runs: a cell holds a reference, and
 * no target can open one, so the run reads it and sends a data URL (ADR-158 §6).
 * @see specs/experiments-v3/attachment-inputs.feature
 */
import {
  DATASET_ATTACHMENT_MAX_BYTES,
  DatasetAttachmentTooLargeError,
  DatasetAttachmentUnavailableError,
  attachmentDisplayName,
  parseDatasetAttachmentRef,
  type DatasetAttachmentRef,
} from "@langwatch/dataset-contract";
import type { ExecutionCell } from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import {
  DATASET_ATTACHMENT_PURPOSE,
  type StoredObjectApi,
  type StoredObjectByteStream,
} from "@langwatch/stored-object-contract";

import type { ExperimentAttachmentLinkChannel } from "../channels/experiment-attachment-link.channel.ts";
import { attachmentDataUrl, type AttachmentBytes } from "../rules/attachment-parts.rules.ts";
import {
  columnTypeOfInputFor,
  type AttachmentDatasetColumn,
} from "../rules/experiment-attachment-input.rules.ts";
import { ExperimentEvaluatorInputService } from "./experiment-evaluator-input.service.ts";

const logger = createLogger("langwatch:experiment:attachments");

const ATTACHMENT_COLUMN_TYPES = new Set(["image", "file"]);

const isExternalUrl = (value: string): boolean => /^https?:\/\//i.test(value);

export class ExperimentAttachmentInputService {
  static create(deps: {
    storedObjects: StoredObjectApi;
    links: ExperimentAttachmentLinkChannel;
  }): ExperimentAttachmentInputService {
    return new ExperimentAttachmentInputService(deps.storedObjects, deps.links);
  }

  private constructor(
    private readonly storedObjects: StoredObjectApi,
    private readonly links: ExperimentAttachmentLinkChannel,
  ) {}

  /**
   * The inputs a target is dispatched with, attachments included. Only an agent or
   * workflow (`shouldFetchExternal`) has a public address read for it; the engine
   * reads one itself for a prompt.
   */
  buildDispatchInputs({
    cell,
    projectId,
    datasetColumns,
    shouldFetchExternal,
  }: {
    cell: ExecutionCell;
    projectId: string;
    datasetColumns: AttachmentDatasetColumn[];
    shouldFetchExternal: boolean;
  }): Promise<Record<string, unknown>> {
    return this.resolveInputs({
      projectId,
      inputs: ExperimentEvaluatorInputService.create({}).buildTargetInputs({ cell }),
      columnTypeOfInput: columnTypeOfInputFor({ cell, datasetColumns }),
      shouldFetchExternal,
    });
  }

  /** The row's inputs with every image or file value read; the same record when none is. */
  async resolveInputs({
    projectId,
    inputs,
    columnTypeOfInput,
    shouldFetchExternal,
  }: {
    projectId: string;
    inputs: Record<string, unknown>;
    columnTypeOfInput: (inputField: string) => string | undefined;
    shouldFetchExternal: boolean;
  }): Promise<Record<string, unknown>> {
    const resolved: Record<string, unknown> = { ...inputs };
    let changed = false;

    for (const [field, value] of Object.entries(inputs)) {
      if (typeof value !== "string" || value === "") continue;
      // The column type decides first: a text cell holding a reference or an address is a sentence.
      const columnType = columnTypeOfInput(field);
      if (!columnType || !ATTACHMENT_COLUMN_TYPES.has(columnType)) continue;

      const ref = parseDatasetAttachmentRef(value);
      if (ref) {
        resolved[field] = await this.readStoredInput({ projectId, ref, value });
        changed = true;
      } else if (shouldFetchExternal && isExternalUrl(value)) {
        resolved[field] = attachmentDataUrl(
          await this.links.fetchAttachment({ url: value, columnType }),
        );
        changed = true;
      }
    }

    return changed ? resolved : inputs;
  }

  private async readStoredInput({
    projectId,
    ref,
    value,
  }: {
    projectId: string;
    ref: DatasetAttachmentRef;
    value: string;
  }): Promise<string> {
    const fileName = ref.name ?? attachmentDisplayName(value);
    // A run reads only its own project's objects, never across tenants.
    if (ref.projectId !== projectId) {
      logger.warn(
        { projectId, refProjectId: ref.projectId },
        "Dataset attachment names another project",
      );
      throw new DatasetAttachmentUnavailableError(fileName);
    }

    const found = await this.readStored({ projectId, objectId: ref.objectId });
    if (!found) {
      logger.warn({ projectId, objectId: ref.objectId }, "Dataset attachment no longer resolves");
      throw new DatasetAttachmentUnavailableError(fileName);
    }

    return attachmentDataUrl({ ...found, name: found.name ?? fileName });
  }

  /** Only a dataset attachment is read: trace and scenario media ask for their own permission. */
  private async readStored({
    projectId,
    objectId,
  }: {
    projectId: string;
    objectId: string;
  }): Promise<AttachmentBytes | null> {
    const found = await this.storedObjects.readById({ projectId, id: objectId });
    if (!found || "status" in found) return null;
    if (found.row.purpose !== DATASET_ATTACHMENT_PURPOSE) {
      await found.stream[Symbol.asyncIterator]().return?.();
      logger.warn(
        { projectId, objectId, purpose: found.row.purpose },
        "Dataset attachment reference names an object of another purpose",
      );
      return null;
    }

    return { mediaType: found.row.media_type, bytes: await readCapped(found.stream) };
  }
}

async function readCapped(stream: StoredObjectByteStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > DATASET_ATTACHMENT_MAX_BYTES) {
      throw new DatasetAttachmentTooLargeError(DATASET_ATTACHMENT_MAX_BYTES);
    }
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}
