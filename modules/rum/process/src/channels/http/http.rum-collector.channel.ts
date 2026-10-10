import type { RumCollectorAnswer, RumCollectorChannel } from "../rum-collector.channel.ts";

/** A hung collector must not leave a forward outstanding indefinitely. */
const COLLECTOR_TIMEOUT_MS = 5_000;

/** Posts each export to the collector's OTLP/HTTP traces address with its auth headers. */
export class HttpRumCollectorChannel implements RumCollectorChannel {
  readonly #tracesUrl: string;
  readonly #headers: Readonly<Record<string, string>>;

  private constructor(tracesUrl: string, headers: Readonly<Record<string, string>>) {
    this.#tracesUrl = tracesUrl;
    this.#headers = headers;
  }

  static create({
    tracesUrl,
    headers,
  }: Readonly<{
    tracesUrl: string;
    headers: Readonly<Record<string, string>>;
  }>): HttpRumCollectorChannel {
    return new HttpRumCollectorChannel(tracesUrl, headers);
  }

  async send(traceExport: string): Promise<RumCollectorAnswer> {
    const response = await fetch(this.#tracesUrl, {
      method: "POST",
      headers: this.#headers,
      body: traceExport,
      signal: AbortSignal.timeout(COLLECTOR_TIMEOUT_MS),
    });
    return { accepted: response.ok, status: response.status };
  }
}
