import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type { EvaluationInputRepository } from "../repositories/evaluation-input.repository.ts";
import type { EvaluationRetentionLookup } from "../repositories/evaluation.repository.ts";
import {
  isSha256Hex,
  legacyEvaluationInputKey,
  retentionClassOf,
} from "../rules/evaluation-input-object.rules.ts";

export const STORED_OBJECT_MARKER_KEY = "__lw_stored_object" as const;

interface StoredObjectInputsMarker {
  [STORED_OBJECT_MARKER_KEY]: {
    id: string;
    /** The full object key, so a retention change never strands it. Absent on main-era markers. */
    key?: string;
    sizeBytes: number;
    sha256: string | null;
    preview: string;
    truncatedPreview: boolean;
    ceilingExceeded?: boolean;
    offloadFailed?: boolean;
  };
}

const storedObjectMarkerSchema = z
  .object({
    [STORED_OBJECT_MARKER_KEY]: z.object({ id: z.string() }).passthrough(),
  })
  .passthrough();

const resolvedInputsSchema = z.record(z.string(), z.unknown());

const logger = createLogger("langwatch:evaluation:inputs-offload");

export const EVAL_INPUTS_INLINE_MAX_BYTES = 1024 * 1024;
export const EVAL_INPUTS_HARD_CEILING_BYTES = 50 * 1024 * 1024;
export const EVAL_INPUTS_PREVIEW_BYTES = 16 * 1024;
const EVALUATION_RUNS_TABLE = "evaluation_runs";

type EvaluationInputOffloadConfig = Readonly<{
  inlineMaxBytes: number;
  hardCeilingBytes: number;
  previewBytes: number;
}>;

export class EvaluationInputsOffloadService {
  static create(input: {
    storage: EvaluationInputRepository;
    retention: EvaluationRetentionLookup;
    config: EvaluationInputOffloadConfig;
  }): EvaluationInputsOffloadService {
    return new EvaluationInputsOffloadService(input.storage, input.retention, input.config);
  }

  /** Whether a stored inputs payload is the marker standing in for an offload. */
  static isStoredObjectMarker(value: unknown): value is StoredObjectInputsMarker {
    return storedObjectMarkerSchema.validate(value);
  }

  private constructor(
    private readonly storage: EvaluationInputRepository,
    private readonly retention: EvaluationRetentionLookup,
    private readonly config: EvaluationInputOffloadConfig,
  ) {}

  async offload(input: {
    tenantId: string;
    evaluationId: string;
    inputs: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    if (EvaluationInputsOffloadService.isStoredObjectMarker(input.inputs)) {
      return input.inputs;
    }

    const serialized = JSON.stringify(input.inputs);
    const sizeBytes = Buffer.byteLength(serialized, "utf8");
    const inlineMaxBytes = Math.min(this.config.inlineMaxBytes, this.config.hardCeilingBytes);
    if (sizeBytes <= inlineMaxBytes) {
      return input.inputs;
    }

    const preview = this.preview(serialized);
    if (sizeBytes > this.config.hardCeilingBytes) {
      logger.warn(
        { tenantId: input.tenantId, evaluationId: input.evaluationId, sizeBytes },
        "Evaluation inputs exceed the hard ceiling",
      );

      return this.marker({
        sizeBytes,
        preview,
        id: null,
        sha256: null,
        ceilingExceeded: true,
      });
    }

    try {
      const bytes = Buffer.from(serialized, "utf8");
      const stored = await this.storage.store({
        tenantId: input.tenantId,
        retentionClass: await this.retentionClass(input.tenantId),
        bytes,
      });

      return this.marker({
        sizeBytes,
        preview,
        id: stored.sha256,
        key: stored.key,
        sha256: stored.sha256,
      });
    } catch (error) {
      logger.warn(
        {
          tenantId: input.tenantId,
          evaluationId: input.evaluationId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Evaluation inputs offload failed",
      );

      return this.marker({
        sizeBytes,
        preview,
        id: null,
        sha256: null,
        offloadFailed: true,
      });
    }
  }

  async resolveInputs(input: {
    tenantId: string;
    inputs: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    if (!EvaluationInputsOffloadService.isStoredObjectMarker(input.inputs)) {
      return input.inputs;
    }

    const marker = input.inputs[STORED_OBJECT_MARKER_KEY];
    const key = this.keyOf({ tenantId: input.tenantId, marker });
    if (key === null) {
      return input.inputs;
    }

    try {
      const stored = await this.storage.read({ tenantId: input.tenantId, key });
      if (stored.kind === "absent") {
        logger.warn(
          { tenantId: input.tenantId, objectKey: key },
          "Offloaded evaluation inputs object missing on read; returning marker with preview",
        );

        return input.inputs;
      }

      const bytes = await this.readBounded(stored.body, this.config.hardCeilingBytes);
      const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
      const parsedObject = resolvedInputsSchema.safeParse(parsed);
      if (parsedObject.success) {
        return parsedObject.data;
      }

      return input.inputs;
    } catch (error) {
      logger.warn(
        {
          tenantId: input.tenantId,
          objectKey: key,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to resolve offloaded evaluation inputs; returning marker with preview",
      );

      return input.inputs;
    }
  }

  /** The marker's own key, else main's address for its hash; a preview-only marker has none. */
  private keyOf({
    tenantId,
    marker,
  }: {
    tenantId: string;
    marker: StoredObjectInputsMarker[typeof STORED_OBJECT_MARKER_KEY];
  }): string | null {
    if (!marker.id) return null;
    if (typeof marker.key === "string") return marker.key;
    if (isSha256Hex(marker.sha256)) {
      return legacyEvaluationInputKey({ tenantId, sha256: marker.sha256 });
    }

    return null;
  }

  private async retentionClass(tenantId: string) {
    const [days] = await this.retention.findRetentionDays({
      tenantId,
      table: EVALUATION_RUNS_TABLE,
    });

    return retentionClassOf({
      retentionDays: days ?? this.retention.getPlatformDefaultRetentionDays(),
    });
  }

  private preview(serialized: string): { value: string; truncated: boolean } {
    if (Buffer.byteLength(serialized, "utf8") <= this.config.previewBytes) {
      return { value: serialized, truncated: false };
    }

    return {
      value: Buffer.from(serialized.slice(0, this.config.previewBytes), "utf8")
        .subarray(0, this.config.previewBytes)
        .toString("utf8"),
      truncated: true,
    };
  }

  private marker(input: {
    sizeBytes: number;
    preview: { value: string; truncated: boolean };
    id: string | null;
    key?: string;
    sha256: string | null;
    ceilingExceeded?: boolean;
    offloadFailed?: boolean;
  }): Record<string, unknown> {
    return {
      [STORED_OBJECT_MARKER_KEY]: {
        id: input.id ?? "",
        ...(input.key ? { key: input.key } : {}),
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        preview: input.preview.value,
        truncatedPreview: input.preview.truncated,
        ...(input.ceilingExceeded ? { ceilingExceeded: true } : {}),
        ...(input.offloadFailed ? { offloadFailed: true } : {}),
      },
    };
  }

  private async readBounded(
    stream: AsyncIterable<Uint8Array>,
    maximumBytes: number,
  ): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of stream) {
      size += chunk.byteLength;
      if (size > maximumBytes) {
        throw new RangeError("Stored evaluation inputs exceed the configured read ceiling");
      }

      chunks.push(chunk);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return bytes;
  }
}

/** Offloads an Evaluation result's inputs before the event is created. */
export interface EvaluationInputsOffload {
  offload(input: {
    tenantId: string;
    evaluationId: string;
    inputs: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}
