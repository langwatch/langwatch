// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { servingEndpointPath } from "../../features/kill-switch/rules/agent-stop-target.rules.ts";
import type { DatabricksServingEndpointChannel } from "../databricks-serving-endpoint.channel.ts";
import type { GovernanceHttpClient } from "../governance-http.channel.ts";
import { httpPlatformCodeOf, KillSwitchPlatformError } from "../kill-switch-platform.channel.ts";

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
    return this.call({ ...args, action: "stop" });
  }

  startEndpoint(args: {
    workspaceUrl: string;
    token: string;
    endpointName: string;
    signal?: AbortSignal;
  }): Promise<void> {
    return this.call({ ...args, action: "start" });
  }

  checkEndpoint(args: {
    workspaceUrl: string;
    token: string;
    endpointName: string;
    signal?: AbortSignal;
  }): Promise<void> {
    return this.call(args);
  }

  /** A POST for `action`, else a GET of the endpoint itself. */
  private async call({
    workspaceUrl,
    token,
    endpointName,
    action,
    signal,
  }: {
    workspaceUrl: string;
    token: string;
    endpointName: string;
    action?: "stop" | "start";
    signal?: AbortSignal;
  }): Promise<void> {
    const path = servingEndpointPath({ endpointName, ...(action ? { action } : {}) });
    const timeout = AbortSignal.timeout(SERVING_TIMEOUT_MS);
    const response = await this.http.fetch(new URL(path, workspaceUrl).toString(), {
      method: action ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(action ? { "Content-Type": "application/json" } : {}),
      },
      ...(action ? { body: "{}" } : {}),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      followRedirects: false,
    });
    if (response.ok) return;
    throw new KillSwitchPlatformError({
      code: httpPlatformCodeOf(response.status),
      message: `Databricks answered HTTP ${response.status} ${response.statusText} to ${path}`,
    });
  }
}
