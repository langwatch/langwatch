// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Vertex AI Agent Engine listing against a scripted Google: sign-in, page tokens, refusals.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */

import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { REAL_VENDOR_BASES } from "../../rules/vendor-bases.rules.ts";
import type { GovernanceHttpClient, GovernanceHttpResponse } from "../governance-http.channel.ts";
import { HttpVertexAgentEngineChannel } from "../http/http.vertex-agent-engine.channel.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  client_email: "lister@acme-ml.iam.gserviceaccount.com",
  private_key: PRIVATE_KEY_PEM,
  token_uri: "https://oauth2.googleapis.com/token",
});
const TARGETS = [{ projectId: "acme-ml", location: "europe-west4" }];

type Call = { url: string; method: string; body?: string; headers: Record<string, string> };
type Answer = { status: number; body: unknown };

class ScriptedGoogle implements GovernanceHttpClient {
  readonly calls: Call[] = [];
  constructor(private readonly answer: (call: Call) => Answer) {}

  async fetch(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<GovernanceHttpResponse> {
    const call = {
      url,
      method: init.method ?? "GET",
      body: init.body,
      headers: init.headers ?? {},
    };
    this.calls.push(call);
    const { status, body } = this.answer(call);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }
}

const engine = (id: string, extra: Record<string, unknown> = {}) => ({
  name: `projects/acme-ml/locations/europe-west4/reasoningEngines/${id}`,
  displayName: `engine-${id}`,
  ...extra,
});

function google({ pages }: { pages: unknown[][] }): ScriptedGoogle {
  return new ScriptedGoogle((call) => {
    if (call.url.endsWith("/token")) return { status: 200, body: { access_token: "ya29.acme" } };
    const token = new URL(call.url).searchParams.get("pageToken");
    const index = token ? Number(token) : 0;
    const next = index + 1 < pages.length ? { nextPageToken: String(index + 1) } : {};
    return { status: 200, body: { reasoningEngines: pages[index], ...next } };
  });
}

const channelOver = (http: GovernanceHttpClient) =>
  HttpVertexAgentEngineChannel.create({ http, nowSeconds: () => 1_800_000_000 });

describe("the Vertex AI Agent Engine listing", () => {
  /** @scenario "A Vertex AI reasoning engine becomes a sighting keyed by its resource name" */
  it("records a reasoning engine under its resource name with its labels", async () => {
    const http = google({
      pages: [
        [
          engine("42", {
            displayName: "claims-agent",
            labels: { owner: "claims", env: "prod" },
            createTime: "2026-09-01T10:00:00Z",
            updateTime: "2026-11-01T10:00:00.123456Z",
          }),
        ],
      ],
    });
    const listing = await channelOver(http).listAgents({
      serviceAccountJson: SERVICE_ACCOUNT,
      targets: TARGETS,
    });

    expect(listing.outcome).toBe("listed");
    if (listing.outcome !== "listed") return;
    expect(listing.items).toHaveLength(1);
    const [agent] = listing.items;
    expect(agent?.rawAgentId).toBe("projects/acme-ml/locations/europe-west4/reasoningEngines/42");
    expect(agent?.displayText).toBe("claims-agent");
    expect(agent?.metadata).toMatchObject({
      platform: "gcp_vertex",
      owner: "claims",
      project: "acme-ml",
      location: "europe-west4",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:00:00.123Z",
      consoleUrl:
        "https://console.cloud.google.com/vertex-ai/agents/locations/europe-west4/agent-engines/42?project=acme-ml",
    });
    expect(JSON.parse(agent?.metadata.tags ?? "")).toEqual({ owner: "claims", env: "prod" });
    expect(JSON.parse(agent?.metadata.matchIds ?? "")).toEqual([
      "projects/acme-ml/locations/europe-west4/reasoningEngines/42",
      "42",
    ]);
    expect(agent?.metadata.model).toBeUndefined();
    expect(http.calls[1]?.url).toBe(
      "https://europe-west4-aiplatform.googleapis.com/v1/projects/acme-ml/locations/europe-west4/reasoningEngines?pageSize=100",
    );
  });

  /** @scenario "The Google Cloud listing signs in with the service account and follows page tokens" */
  it("exchanges one signed assertion and walks every page", async () => {
    const http = google({ pages: [[engine("1"), engine("2")], [engine("3")]] });
    const listing = await channelOver(http).listAgents({
      serviceAccountJson: SERVICE_ACCOUNT,
      targets: TARGETS,
    });

    expect(listing.outcome).toBe("listed");
    if (listing.outcome !== "listed") return;
    expect(listing.items.map((agent) => agent.displayText)).toEqual([
      "engine-1",
      "engine-2",
      "engine-3",
    ]);

    const tokenCalls = http.calls.filter((call) => call.url.endsWith("/token"));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(tokenCalls[0]?.body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [header, claims, signature] = (form.get("assertion") ?? "").split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    expect(
      verifier.verify(createPublicKey(privateKey), Buffer.from(signature ?? "", "base64url")),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(claims ?? "", "base64url").toString())).toEqual({
      iss: "lister@acme-ml.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });

    const pageCalls = http.calls.filter((call) => call.url.includes("reasoningEngines"));
    expect(pageCalls.map((call) => new URL(call.url).searchParams.get("pageToken"))).toEqual([
      null,
      "1",
    ]);
    expect(pageCalls.every((call) => call.headers.Authorization === "Bearer ya29.acme")).toBe(true);
  });

  it("reaches the configured token and API bases", async () => {
    const http = google({ pages: [[engine("1")]] });
    await HttpVertexAgentEngineChannel.create({
      http,
      vendorBases: {
        ...REAL_VENDOR_BASES,
        googleOauthToken: "http://localhost:4611/",
        vertexAiApi: "http://localhost:4611",
      },
    }).listAgents({ serviceAccountJson: SERVICE_ACCOUNT, targets: TARGETS });
    expect(http.calls.map((call) => call.url)).toEqual([
      "http://localhost:4611/token",
      "http://localhost:4611/v1/projects/acme-ml/locations/europe-west4/reasoningEngines?pageSize=100",
    ]);
  });

  /** @scenario "A service account key that does not parse refuses as not configured" */
  it.each([
    ["not JSON", "not json"],
    [
      "another key type",
      JSON.stringify({ type: "authorized_user", client_email: "a", private_key: "b" }),
    ],
    [
      "an unreadable private key",
      JSON.stringify({ type: "service_account", client_email: "a", private_key: "b" }),
    ],
  ])("refuses %s as not configured without calling Google", async (_name, json) => {
    const http = google({ pages: [[]] });
    const listing = await channelOver(http).listAgents({
      serviceAccountJson: json,
      targets: TARGETS,
    });
    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "not_configured", status: null },
    });
    expect(http.calls).toHaveLength(0);
  });

  /** @scenario "A token exchange the identity service refuses reads as unauthorized" */
  it.each([
    [400, { error: "invalid_grant", error_description: "Invalid JWT Signature." }],
    [401, { error: "unauthorized_client" }],
    [403, { error: "access_denied" }],
  ])("reads a %s from the token endpoint as unauthorized", async (status, body) => {
    const http = new ScriptedGoogle(() => ({ status, body }));
    const listing = await channelOver(http).listAgents({
      serviceAccountJson: SERVICE_ACCOUNT,
      targets: TARGETS,
    });
    expect(listing).toEqual({ outcome: "refused", refusal: { reason: "unauthorized", status } });
    expect(http.calls).toHaveLength(1);
  });

  it("refuses a walk that never ends as too many pages", async () => {
    let page = 0;
    const http = new ScriptedGoogle((call) =>
      call.url.endsWith("/token")
        ? { status: 200, body: { access_token: "t" } }
        : { status: 200, body: { reasoningEngines: [], nextPageToken: `p${page++}` } },
    );
    const listing = await channelOver(http).listAgents({
      serviceAccountJson: SERVICE_ACCOUNT,
      targets: TARGETS,
    });
    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "too_many_pages", status: null },
    });
  });

  it("answers empty when no target holds an engine", async () => {
    const listing = await channelOver(google({ pages: [[]] })).listAgents({
      serviceAccountJson: SERVICE_ACCOUNT,
      targets: TARGETS,
    });
    expect(listing).toEqual({ outcome: "empty", items: [] });
  });
});
