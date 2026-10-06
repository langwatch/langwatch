/**
 * Tells the engine the largest attachment it may fetch for a run: the file
 * limit of the project's organization, sent on every event that runs a graph.
 * @see modules/workflow/specs/workflow-service.feature
 */
import type { DatasetApi } from "@langwatch/dataset-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { WorkflowNlpRuntime } from "../app/workflow.app.ts";
import type { WorkflowStudioStream } from "../channels/nlp-lambda.channel.ts";

const logger = createLogger("langwatch:workflows:engine-attachment-limit");

/** How long an answer is kept, so the cells of one run ask once between them. */
const LIMIT_TTL_MS = 60_000;

/** Projects remembered at once; the oldest answer leaves first. */
const REMEMBERED_PROJECTS = 500;

/** The payload field the engine reads its per-request attachment limit from. */
const ENGINE_MAX_ATTACHMENT_BYTES_FIELD = "max_attachment_bytes";

type Remembered = { maxBytes: Promise<number>; expiresAtMs: number };

export class WorkflowEngineAttachmentLimitService {
  static create(deps: {
    datasets: Pick<DatasetApi, "getLimits">;
  }): WorkflowEngineAttachmentLimitService {
    return new WorkflowEngineAttachmentLimitService(deps.datasets);
  }

  private readonly remembered = new Map<string, Remembered>();

  private constructor(private readonly datasets: Pick<DatasetApi, "getLimits">) {}

  /** The streaming route, with the project's limit on every run it opens. */
  limitedStream(inner: WorkflowStudioStream): WorkflowStudioStream {
    return {
      open: async (input) =>
        inner.open({ ...input, body: await this.stamp(input.projectId, input.body) }),
    };
  }

  /** The synchronous route, with the project's limit on every run it dispatches. */
  limitedRuntime(inner: WorkflowNlpRuntime): WorkflowNlpRuntime {
    return {
      dispatch: async (input) =>
        inner.dispatch({ ...input, body: await this.stamp(input.projectId, input.body) }),
    };
  }

  /**
   * The event with the limit in its payload. Only an event that carries a
   * graph runs one, so liveness probes and stop events pass as they are. A
   * failed lookup sends the event unstamped and the engine holds its default.
   */
  private async stamp<Body extends object>(projectId: string, body: Body): Promise<Body> {
    const payload: unknown = "payload" in body ? body.payload : undefined;
    if (typeof payload !== "object" || payload === null || !("workflow" in payload)) return body;

    try {
      const maxBytes = await this.maxBytesFor(projectId);

      return { ...body, payload: { ...payload, [ENGINE_MAX_ATTACHMENT_BYTES_FIELD]: maxBytes } };
    } catch (error) {
      logger.warn({ error, projectId }, "Attachment limit lookup failed; engine default applies");

      return body;
    }
  }

  private maxBytesFor(projectId: string): Promise<number> {
    const nowMs = nowInstant().epochMilliseconds;
    const known = this.remembered.get(projectId);
    if (known && known.expiresAtMs > nowMs) return known.maxBytes;

    const maxBytes = this.datasets.getLimits({ projectId }).then((limits) => limits.attachmentBytes);
    this.remembered.delete(projectId);
    this.remembered.set(projectId, { maxBytes, expiresAtMs: nowMs + LIMIT_TTL_MS });
    maxBytes.catch(() => this.remembered.delete(projectId));
    for (const oldest of this.remembered.keys()) {
      if (this.remembered.size <= REMEMBERED_PROJECTS) break;
      this.remembered.delete(oldest);
    }

    return maxBytes;
  }
}
