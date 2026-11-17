// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { servingEndpointPath } from "../../features/kill-switch/rules/agent-stop-target.rules.ts";
import type { DatabricksServingEndpointChannel } from "../databricks-serving-endpoint.channel.ts";
import type { GovernanceHttpClient } from "../governance-http.channel.ts";
import { KillSwitchPlatformError } from "../kill-switch-platform.channel.ts";

/** A person or a trace rule is waiting on the stop; a slow workspace is retried by the outbox. */
const SERVING_TIMEOUT_MS = 20_000;

/**
 * The workspace's serving endpoint API, through governance's SSRF-safe client. A redirect is never
 * followed: it would carry the workspace token to a host nobody chose.
 */
export class HttpDatabricksServingEndpointChannel implements DatabricksServingEndpointChannel {
  private constructor(private readonly http: GovernanceHttpClient) {}

  static create({ http }: { http: GovernanceHttpClient }): HttpDatabricksServingEndpointChannel {
    return new HttpDatabricksServingEndpointChannel(http);
  }

  stopEndpoint(args: {
    workspaceUrl: string;
    token: string;
    endpointName: string;
    signal?: AbortSignal;
  }): Promise<void> {
    return this.post({ ...args, action: "stop" });
  }

  startEndpoint(args: {
    workspaceUrl: string;
    token: string;
    endpointName: string;
    signal?: AbortSignal;
  }): Promise<void> {
    return this.post({ ...args, action: "start" });
  }

  private async post({
    workspaceUrl,
    token,
    endpointName,
    action,
    signal,
  }: {
    workspaceUrl: string;
    token: string;
    endpointName: string;
    action: "stop" | "start";
    signal?: AbortSignal;
  }): Promise<void> {
    const path = servingEndpointPath({ endpointName, action });
    const timeout = AbortSignal.timeout(SERVING_TIMEOUT_MS);
    const response = await this.http.fetch(new URL(path, workspaceUrl).toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      followRedirects: false,
    });
    if (response.ok) return;
    throw new KillSwitchPlatformError({
      code: `http_${response.status}`,
      message: `Databricks answered HTTP ${response.status} ${response.statusText} to ${path}`,
    });
  }
}
