import {
  DATASET_ATTACHMENT_MAX_BYTES,
  DatasetAttachmentTooLargeError,
  DatasetAttachmentUnavailableError,
  attachmentDisplayName,
} from "@langwatch/dataset-contract";
import {
  createSsrfUrlValidator,
  type EgressTlsPolicy,
  type FencedFetchOptions,
  fetchValidatedDestination,
  type SsrfUrlValidator,
  type SsrfValidationResult,
} from "@langwatch/egress";
import { createLogger } from "@langwatch/observability";

import type { AttachmentBytes } from "../../rules/attachment-parts.rules.ts";
import type { ExperimentAttachmentLinkChannel } from "../experiment-attachment-link.channel.ts";

const logger = createLogger("langwatch:experiment:attachment-link");

/** How long the run waits for an address on the public internet. */
export const ATTACHMENT_LINK_TIMEOUT_MS = 30_000;

/** The address policy a deployment fences a run's attachment reads with. */
export type ExperimentAttachmentEgressPolicy = Readonly<{
  blockLocal: boolean;
  allowedHosts: readonly string[];
  verifyTls: boolean;
}>;

/** What this channel reads of an answered fetch, and nothing else. */
export interface AttachmentLinkResponse {
  ok: boolean;
  headers: Pick<Headers, "get">;
  body: { getReader(): AttachmentLinkBodyReader } | null;
}

interface AttachmentLinkBodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<unknown>;
}

/** The fenced fetch seam, injected so a test never opens a socket. */
export type FencedAttachmentFetch = (
  validated: SsrfValidationResult,
  init: FencedFetchOptions,
  tls: EgressTlsPolicy,
) => Promise<AttachmentLinkResponse>;

/**
 * The address belongs to whoever wrote the cell, so its answer is never trusted:
 * a declared size over the ceiling is refused unread, the body is cut at the
 * ceiling, and an image column only takes a picture. Every hop is fenced.
 */
export class HttpExperimentAttachmentLinkChannel implements ExperimentAttachmentLinkChannel {
  private constructor(
    private readonly validate: SsrfUrlValidator,
    private readonly fetchValidated: FencedAttachmentFetch,
    private readonly tls: EgressTlsPolicy,
  ) {}

  static create(options: {
    policy: ExperimentAttachmentEgressPolicy;
    validate?: SsrfUrlValidator;
    fetchValidated?: FencedAttachmentFetch;
  }): HttpExperimentAttachmentLinkChannel {
    return new HttpExperimentAttachmentLinkChannel(
      options.validate ??
        createSsrfUrlValidator({
          blockLocal: options.policy.blockLocal,
          allowedHosts: [...options.policy.allowedHosts],
        }),
      options.fetchValidated ?? fetchValidatedDestination,
      { rejectUnauthorized: options.policy.verifyTls },
    );
  }

  async fetchAttachment({
    url,
    columnType,
  }: {
    url: string;
    columnType?: string;
  }): Promise<AttachmentBytes> {
    const name = attachmentDisplayName(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTACHMENT_LINK_TIMEOUT_MS);
    try {
      const response = await this.fetchValidated(
        await this.validate(url),
        {
          method: "GET",
          signal: controller.signal,
          followRedirects: true,
          revalidate: this.validate,
        },
        this.tls,
      );
      if (!response.ok) throw new DatasetAttachmentUnavailableError(name);

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > DATASET_ATTACHMENT_MAX_BYTES) {
        throw new DatasetAttachmentTooLargeError(DATASET_ATTACHMENT_MAX_BYTES);
      }

      const mediaType =
        response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
      if (columnType === "image" && !mediaType.startsWith("image/")) {
        logger.warn(
          { url, mediaType },
          "Image column address answered with something other than a picture",
        );
        throw new DatasetAttachmentUnavailableError(name);
      }
      if (!response.body) throw new DatasetAttachmentUnavailableError(name);

      return { mediaType, bytes: await readCapped(response.body.getReader()), name };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readCapped(reader: AttachmentLinkBodyReader): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= DATASET_ATTACHMENT_MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) return Buffer.concat(chunks);
    total += value.byteLength;
    chunks.push(Buffer.from(value));
  }
  await reader.cancel();
  throw new DatasetAttachmentTooLargeError(DATASET_ATTACHMENT_MAX_BYTES);
}
