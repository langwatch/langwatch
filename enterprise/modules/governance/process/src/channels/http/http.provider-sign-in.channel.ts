// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { ProviderSignInError } from "@langwatch/enterprise-governance-contract";
import { z } from "zod";

import type { GovernanceHttpClient } from "../../app/governance.members.ts";
import type { ProviderSignInChannel } from "../provider-sign-in.channel.ts";

const TOKEN_TIMEOUT_MS = 15_000;

/** Only `access_token` is load-bearing: a token is minted per call and outlives it. */
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(TOKEN_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Both token endpoints over the SSRF-guarded client. Each request carries the client secret
 * itself, so no redirect is ever followed, and a refusal names the status alone — a token
 * endpoint may echo the request back.
 */
export class HttpProviderSignInChannel implements ProviderSignInChannel {
  private constructor(private readonly http: GovernanceHttpClient) {}

  static create({ http }: { http: GovernanceHttpClient }): HttpProviderSignInChannel {
    return new HttpProviderSignInChannel(http);
  }

  async getWorkspaceToken({
    credentials,
    workspaceUrl,
    signal,
  }: {
    credentials: Record<string, string> | undefined;
    workspaceUrl: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const pasted = credentials?.token;
    if (pasted) return pasted;

    const clientId = credentials?.clientId;
    const clientSecret = credentials?.clientSecret;
    if (!clientId || !clientSecret) {
      throw new ProviderSignInError(
        "databricks genie puller needs either a workspace token in credentials.token, " +
          "or a service principal's credentials.clientId and credentials.clientSecret",
        { reason: "not_configured" },
      );
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await this.http.fetch(`${workspaceUrl.replace(/\/+$/, "")}/oidc/v1/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=all-apis",
      signal: withTimeout(signal),
      followRedirects: false,
    });

    if (!response.ok) {
      throw new ProviderSignInError(
        `databricks genie puller could not sign in: the workspace refused the ` +
          `service principal's credentials (HTTP ${response.status})`,
        { reason: "refused", status: response.status },
      );
    }
    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ProviderSignInError(
        "databricks genie puller could not sign in: the workspace answered the " +
          "sign-in without an access token",
        { reason: "malformed_response" },
      );
    }
    return parsed.data.access_token;
  }

  async getEnvironmentToken({
    credentials,
    environmentUrl,
    scope,
    signal,
  }: {
    credentials: Record<string, string> | undefined;
    environmentUrl: string;
    scope?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const tenantId = credentials?.tenantId;
    const clientId = credentials?.clientId;
    const clientSecret = credentials?.clientSecret;
    if (!tenantId || !clientId || !clientSecret) {
      throw new ProviderSignInError(
        "copilot studio dataverse puller needs credentials.tenantId, " +
          "credentials.clientId and credentials.clientSecret from the app registration",
        { reason: "not_configured" },
      );
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: scope ?? `${environmentUrl.replace(/\/+$/, "")}/.default`,
    });
    const response = await this.http.fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: withTimeout(signal),
        followRedirects: false,
      },
    );

    if (!response.ok) {
      throw new ProviderSignInError(
        "copilot studio dataverse puller could not sign in: Microsoft refused " +
          `the application's credentials (HTTP ${response.status})`,
        { reason: "refused", status: response.status },
      );
    }
    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ProviderSignInError(
        "copilot studio dataverse puller could not sign in: Microsoft answered " +
          "the sign-in without an access token",
        { reason: "malformed_response" },
      );
    }
    return parsed.data.access_token;
  }
}
