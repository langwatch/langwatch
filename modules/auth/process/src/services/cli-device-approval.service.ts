import { CliDeviceFlowRefusedError } from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { CliDeviceCodeRecord, CliDeviceSessionService } from "./cli-device-session.service.ts";

const logger = createLogger("langwatch:auth-cli");

/** How often the stream writes a ping so proxies keep it open. */
const APPROVAL_KEEPALIVE_MS = 15_000;

/**
 * Minting a device code takes no credential, so without a ceiling anyone could
 * park a connection and a subscription per code. Past it the pod refuses and the CLI polls.
 */
const MAX_OPEN_APPROVAL_STREAMS = 512;

/** One frame of the approval stream: the settled status, or a keepalive ping. */
export type CliDeviceApprovalFrame = Readonly<{ event?: "ping"; data: string }>;

function statusFrame(status: string): CliDeviceApprovalFrame {
  return { data: JSON.stringify({ status }) };
}

async function* only(frame: CliDeviceApprovalFrame): AsyncIterable<CliDeviceApprovalFrame> {
  yield frame;
}

/**
 * `GET /api/auth/cli/device-approval`: tells the CLI the moment its code settles so it polls
 * `/exchange` now. An accelerator, never a credential: it carries no tokens, and ends on the
 * first settle, the code's deadline or a disconnect.
 * @see specs/ai-gateway/governance/cli-login.feature
 */
export class CliDeviceApprovalService {
  readonly #sessions: () => CliDeviceSessionService;
  #openStreams = 0;

  private constructor(sessions: () => CliDeviceSessionService) {
    this.#sessions = sessions;
  }

  static create({
    sessions,
  }: {
    sessions: () => CliDeviceSessionService;
  }): CliDeviceApprovalService {
    return new CliDeviceApprovalService(sessions);
  }

  async watch({
    deviceCode,
    signal,
  }: {
    deviceCode: string;
    signal: AbortSignal | undefined;
  }): Promise<AsyncIterable<CliDeviceApprovalFrame>> {
    const record = await this.#storedDeviceCode(deviceCode);
    const deadline = record?.expires_at ?? nowInstant().epochMilliseconds;

    // A settled or unknown code needs no wait: the CLI's next poll can go out now.
    if (record?.status !== "pending" || nowInstant().epochMilliseconds > deadline) {
      return only(statusFrame(record?.status ?? "expired"));
    }

    if (this.#openStreams >= MAX_OPEN_APPROVAL_STREAMS) {
      throw new CliDeviceFlowRefusedError({
        refusal: {
          error: "temporarily_unavailable",
          error_description:
            "Too many approval streams are open. Poll /exchange at the interval you were given.",
        },
        httpStatus: 503,
      });
    }

    return this.#waitForSettlement({ deviceCode, deadline, signal });
  }

  async *#waitForSettlement({
    deviceCode,
    deadline,
    signal,
  }: {
    deviceCode: string;
    deadline: number;
    signal: AbortSignal | undefined;
  }): AsyncIterable<CliDeviceApprovalFrame> {
    this.#openStreams++;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const closeOnDeadline = setTimeout(
      abort,
      Math.max(1000, deadline - nowInstant().epochMilliseconds),
    );
    signal?.addEventListener("abort", abort, { once: true });
    let settle: (status: string | null) => void = () => undefined;
    const settled = new Promise<string | null>((resolve) => {
      settle = resolve;
    });
    controller.signal.addEventListener("abort", () => settle(null), { once: true });
    let release: () => void = () => undefined;

    try {
      release = await this.#sessions().listenForSettlement({ deviceCode, onSettled: settle });

      // Pub/sub keeps nothing for a late subscriber, so re-read once the channel is live.
      const current = await this.#storedDeviceCode(deviceCode);
      if (current?.status !== "pending") settle(current?.status ?? "expired");

      while (!controller.signal.aborted) {
        let keepalive: ReturnType<typeof setTimeout> | undefined;
        const ping = new Promise<undefined>((resolve) => {
          keepalive = setTimeout(() => resolve(undefined), APPROVAL_KEEPALIVE_MS);
        });
        const next = await Promise.race([settled.then((status) => ({ status })), ping]);
        clearTimeout(keepalive);

        if (next === undefined) {
          yield { event: "ping", data: "" };
          continue;
        }
        if (next.status) yield statusFrame(next.status);

        return;
      }
    } catch (error) {
      logger.debug(
        { error },
        "[auth-cli] device-approval stream ended early; the CLI's own poll still settles the login",
      );
    } finally {
      clearTimeout(closeOnDeadline);
      signal?.removeEventListener("abort", abort);
      controller.abort();
      release();
      this.#openStreams--;
    }
  }

  /** The code's record, or none once it was never minted, expired or was consumed. */
  #storedDeviceCode(deviceCode: string): Promise<CliDeviceCodeRecord | undefined> {
    return this.#sessions()
      .getDeviceCode(deviceCode)
      .catch((error: unknown) => {
        if (error instanceof CliDeviceFlowRefusedError) return undefined;
        throw error;
      });
  }
}
