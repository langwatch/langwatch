import type { SubsystemProbeChannel, SubsystemProbeRequest } from "../subsystem-probe.channel.ts";

/** Sends each canary over HTTP to the deployment's public origin. */
export class HttpSubsystemProbeChannel implements SubsystemProbeChannel {
  readonly #publicBaseUrl: string;

  private constructor(publicBaseUrl: string) {
    this.#publicBaseUrl = publicBaseUrl;
  }

  static create({ publicBaseUrl }: { publicBaseUrl: string }): HttpSubsystemProbeChannel {
    return new HttpSubsystemProbeChannel(publicBaseUrl);
  }

  post({ path, headers, body }: SubsystemProbeRequest & { body: string }): Promise<Response> {
    return fetch(`${this.#publicBaseUrl}${path}`, { method: "POST", headers, body });
  }

  get({ path, headers }: SubsystemProbeRequest): Promise<Response> {
    return fetch(`${this.#publicBaseUrl}${path}`, { headers });
  }
}
