import {
  createSsrfUrlValidator,
  type EgressTlsPolicy,
  type FencedFetchOptions,
  RedirectRefusedError,
  type SsrfUrlValidator,
  type SsrfValidationResult,
  fetchValidatedDestination,
} from "@langwatch/egress";
import { createLogger } from "@langwatch/observability";

import type {
  SsoDomainFileFetch,
  SsoDomainProofFileChannel,
} from "../sso-domain-proof-file.channel.ts";

const logger = createLogger("langwatch:identity:sso-domain-file");

/**
 * How long we wait for the customer's web server, and how much of its answer
 * we read. Bounded for the reason the DNS lookup is: a server that streams
 * forever must cost a refusal, not a held connection.
 */
const FILE_FETCH_TIMEOUT_MS = 5_000;
const FILE_MAX_BYTES = 64 * 1024;

/** The address policy a deployment fences this ceremony's egress with. */
export type SsoDomainProofEgressPolicy = Readonly<{
  /** Refuse private, loopback and link-local destinations, and names resolving to them. */
  blockLocal: boolean;
  /** The literal hostname allowlist that relaxes the local block, and only it. */
  allowedHosts: readonly string[];
  /** Whether an outbound TLS certificate is verified. On-prem often self-signs. */
  verifyTls: boolean;
}>;

/** What this channel reads of an answered fetch, and nothing else. */
export interface ProofFileResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  body: { getReader(): ProofFileBodyReader } | null;
}

interface ProofFileBodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<unknown>;
}

/** The fenced fetch seam, injected so a test never opens a socket. */
export type FencedProofFetch = (
  validated: SsrfValidationResult,
  init: FencedFetchOptions,
  tls: EgressTlsPolicy,
) => Promise<ProofFileResponse>;

/**
 * A hop the domain redirected onto plain http. Its own class so the catch
 * below can name it: a token read over http could have been answered by
 * anybody in between, which is what the ceremony exists to rule out.
 */
class ProofFileDowngradedError extends Error {
  constructor() {
    super("a verification file is only read over https");
  }
}

/**
 * Reading a domain's proof out of a file it serves. `@langwatch/egress` is
 * what makes it safe: every hop is judged and the socket pinned to the
 * judged address, so a name cannot answer differently for the connection.
 */
export class HttpsSsoDomainProofFileChannel implements SsoDomainProofFileChannel {
  private constructor(
    private readonly validate: SsrfUrlValidator,
    private readonly fetchValidated: FencedProofFetch,
    private readonly tls: EgressTlsPolicy,
  ) {}

  static create(options: {
    policy: SsoDomainProofEgressPolicy;
    validate?: SsrfUrlValidator;
    fetchValidated?: FencedProofFetch;
  }): HttpsSsoDomainProofFileChannel {
    return new HttpsSsoDomainProofFileChannel(
      options.validate ??
        createSsrfUrlValidator({
          blockLocal: options.policy.blockLocal,
          allowedHosts: [...options.policy.allowedHosts],
        }),
      options.fetchValidated ?? fetchValidatedDestination,
      { rejectUnauthorized: options.policy.verifyTls },
    );
  }

  /** Every hop, the first included: https, then the deployment's fence. */
  private readonly judge: SsrfUrlValidator = async (url) => {
    if (!url.toLowerCase().startsWith("https://")) throw new ProofFileDowngradedError();

    return this.validate(url);
  };

  async fetchVerificationFile({
    domain,
    url,
  }: {
    domain: string;
    url: string;
  }): Promise<SsoDomainFileFetch> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FILE_FETCH_TIMEOUT_MS);
    try {
      const validated = await this.judge(url);
      const response = await this.fetchValidated(
        validated,
        {
          method: "GET",
          headers: { accept: "text/plain" },
          signal: controller.signal,
          followRedirects: true,
          revalidate: this.judge,
        },
        this.tls,
      );

      return await classifyFileResponse({ domain, url, response });
    } catch (error) {
      return this.refusal({ domain, url, error, aborted: controller.signal.aborted });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Each refusal is its own sentence: telling somebody whose web server
   * merely canonicalises to http that we could not reach their host sends
   * them to argue with their DNS team about a redirect.
   */
  private refusal({
    domain,
    url,
    error,
    aborted,
  }: {
    domain: string;
    url: string;
    error: unknown;
    aborted: boolean;
  }): SsoDomainFileFetch {
    const reason = reasonFor({ error, aborted });
    logger.warn({ domain, url, reason, error }, "the verification file could not be fetched");

    return { outcome: "unreachable", reason };
  }
}

/**
 * `host_refused` is every destination the fence turned away before a socket:
 * it states those as prose rather than codes, and reading its sentences here
 * would break the moment one is reworded.
 */
function reasonFor({ error, aborted }: { error: unknown; aborted: boolean }): string {
  if (error instanceof ProofFileDowngradedError) return "not_https";
  if (error instanceof RedirectRefusedError) return "redirect_refused";
  if (aborted) return "timeout";
  const code =
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : null;

  return code ?? (error instanceof Error ? "host_refused" : "fetch_failed");
}

/** What an answered fetch actually says, in the channel's three outcomes. */
async function classifyFileResponse({
  domain,
  url,
  response,
}: {
  domain: string;
  url: string;
  response: ProofFileResponse;
}): Promise<SsoDomainFileFetch> {
  // The two statuses that SAY the file is not there. A 403, a 500, a 503 is
  // the server refusing to answer the question, which is not the same fact.
  if (response.status === 404 || response.status === 410) {
    logger.info({ domain, url }, "no verification file is served");

    return { outcome: "absent" };
  }
  if (!response.ok) {
    logger.warn({ domain, url, status: response.status }, "the verification file was not served");

    return { outcome: "unreachable", reason: `http_${response.status}` };
  }

  const body = await readBoundedBody(response, FILE_MAX_BYTES);
  if (body.outcome === "too-large") {
    logger.warn({ domain, url, cap: FILE_MAX_BYTES }, "the verification file is too large");

    return { outcome: "unreachable", reason: "file_too_large" };
  }
  const values = body.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (values.length === 0) return { outcome: "absent" };

  return { outcome: "served", values };
}

/** The body, read only as far as the cap allows: a server streaming forever
 *  costs a bounded read rather than our memory. */
type BoundedBody = { outcome: "read"; text: string } | { outcome: "too-large" };

async function readBoundedBody(response: ProofFileResponse, cap: number): Promise<BoundedBody> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();

    return text.length > cap ? { outcome: "too-large" } : { outcome: "read", text };
  }

  const decoder = new TextDecoder();
  let read = 0;
  let text = "";
  while (read <= cap) {
    const { done, value } = await reader.read();
    if (done || !value) return { outcome: "read", text: text + decoder.decode() };

    read += value.byteLength;
    if (read > cap) break;

    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();

  return { outcome: "too-large" };
}
