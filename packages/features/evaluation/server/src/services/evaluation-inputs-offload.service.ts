import { createHash } from "node:crypto";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { EvaluationInputStoragePort } from "../ports/evaluation.port";

export const STORED_OBJECT_MARKER_KEY = "__lw_stored_object" as const;

export interface StoredObjectInputsMarker {
  [STORED_OBJECT_MARKER_KEY]: {
    id: string;
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

export function isStoredObjectMarker(value: unknown): value is StoredObjectInputsMarker {
  return storedObjectMarkerSchema.safeParse(value).success;
}

const logger = createLogger("langwatch:evaluation:inputs-offload");

export const EVAL_INPUTS_INLINE_MAX_BYTES = 1024 * 1024;
export const EVAL_INPUTS_HARD_CEILING_BYTES = 50 * 1024 * 1024;
export const EVAL_INPUTS_PREVIEW_BYTES = 16 * 1024;
export const EVAL_INPUTS_STORED_OBJECT_PURPOSE = "evaluation_inputs" as const;

export type EvaluationInputOffloadConfig = Readonly<{
  inlineMaxBytes: number;
  hardCeilingBytes: number;
  previewBytes: number;
}>;

export const EVALUATION_INPUTS_STORED_OBJECT_MARKER_KEY = STORED_OBJECT_MARKER_KEY;

export class EvaluationInputsOffloadService {
  static create(input: {
    storage: EvaluationInputStoragePort;
    config: EvaluationInputOffloadConfig;
  }): EvaluationInputsOffloadService {
    return new EvaluationInputsOffloadService(input.storage, input.config);
  }

  private constructor(
    private readonly storage: EvaluationInputStoragePort,
    private readonly config: EvaluationInputOffloadConfig,
  ) {}

  async offload(input: {
    tenantId: string;
    evaluationId: string;
    inputs: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    if (isStoredObjectMarker(input.inputs)) {
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
        evaluationId: input.evaluationId,
        bytes,
      });

      return this.marker({
        sizeBytes,
        preview,
        id: stored.id,
        sha256: createHash("sha256").update(bytes).digest("hex"),
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

  async tryResolve(input: {
    tenantId: string;
    inputs: Record<string, unknown> | null;
  }): Promise<Record<string, unknown> | null> {
    if (input.inputs === null || !isStoredObjectMarker(input.inputs)) {
      return input.inputs;
    }

    const marker = input.inputs[STORED_OBJECT_MARKER_KEY];
    if (!marker.id) {
      return input.inputs;
    }

    try {
      const stream = await this.storage.tryRead({
        tenantId: input.tenantId,
        id: marker.id,
      });
      if (!stream) {
        logger.warn(
          { tenantId: input.tenantId, storedObjectId: marker.id },
          "Offloaded evaluation inputs object missing on read; returning marker with preview",
        );

        return input.inputs;
      }

      const bytes = await this.readBounded(stream, this.config.hardCeilingBytes);
      const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
      const parsedObject = z.record(z.string(), z.unknown()).safeParse(parsed);
      if (parsedObject.success) {
        return parsedObject.data;
      }

      return input.inputs;
    } catch (error) {
      logger.warn(
        {
          tenantId: input.tenantId,
          storedObjectId: marker.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to resolve offloaded evaluation inputs; returning marker with preview",
      );

      return input.inputs;
    }
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
    sha256: string | null;
    ceilingExceeded?: boolean;
    offloadFailed?: boolean;
  }): Record<string, unknown> {
    return {
      [STORED_OBJECT_MARKER_KEY]: {
        id: input.id ?? "",
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
