import { ConnectUnreachableError } from "@langwatch/enterprise-licensing-contract";

import type { CheckupProbeAnswer, CheckupProbeChannel } from "../checkup-probe.channel.ts";

const REACH_TIMEOUT_MS = 5_000;

/** Any HTTP answer means the host is reachable; the probe asks for nothing it has to agree to. */
export class HttpCheckupProbeChannel implements CheckupProbeChannel {
  private constructor() {}

  static create(): HttpCheckupProbeChannel {
    return new HttpCheckupProbeChannel();
  }

  async reach(url: string): Promise<void> {
    try {
      const response = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(REACH_TIMEOUT_MS),
      });
      await response.body?.cancel();
    } catch (error) {
      const target = new URL(url);
      throw new ConnectUnreachableError({
        host: target.hostname,
        port: Number(target.port || (target.protocol === "http:" ? 80 : 443)),
        ...(error instanceof Error ? { cause: error } : {}),
      });
    }
  }

  async get({
    url,
    headers,
    timeoutMs,
  }: {
    url: string;
    headers?: Readonly<Record<string, string>>;
    timeoutMs: number;
  }): Promise<CheckupProbeAnswer> {
    const response = await fetch(url, {
      ...(headers ? { headers: { ...headers } } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    return { status: response.status, body: parsedOrText(text) };
  }
}

/** A plain-text answer is reported as it came. */
function parsedOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
