// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The ARD registry listing against a scripted registry: manifest, search pages, version refusal.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */

import { describe, expect, it } from "vitest";

import type { GovernanceHttpClient, GovernanceHttpResponse } from "../governance-http.channel.ts";
import { HttpArdRegistryChannel } from "../http/http.ard-registry.channel.ts";

type Call = { url: string; method: string; body?: string; headers: Record<string, string> };

class ScriptedRegistry implements GovernanceHttpClient {
  readonly calls: Call[] = [];
  constructor(private readonly answer: (call: Call) => { status: number; body: unknown }) {}

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

const entry = (name: string, extra: Record<string, unknown> = {}) => ({
  "@context": "https://agenticresourcediscovery.org/context/v1",
  identifier: `urn:air:registry.acme.test:agent:${name}`,
  displayName: name,
  type: "application/agent-card+json",
  version: "3",
  updatedAt: "2026-11-02T08:00:00Z",
  tags: ["team:support"],
  capabilities: [],
  metadata: {},
  ...extra,
});

const manifest = (entries: unknown[], specVersion = "0.91") => ({
  specVersion,
  publisher: "registry.acme.test",
  updatedAt: "2026-11-02T08:00:00Z",
  entries,
});

describe("the ARD registry listing", () => {
  /** @scenario "An ARD registry's entries become sightings keyed by their urn:air identifiers" */
  it("records each urn:air entry of the manifest under its identifier", async () => {
    const http = new ScriptedRegistry(() => ({
      status: 200,
      body: manifest([
        entry("triage", {
          metadata: { owner: "support" },
          data: { model: { model: "anthropic/claude-sonnet-5" } },
        }),
        { identifier: "https://elsewhere.acme.test/agent", displayName: "not an air id" },
      ]),
    }));
    const listing = await HttpArdRegistryChannel.create({ http }).listAgents({
      registryUrl: "registry.acme.test",
      bearerToken: "acme-token",
    });

    expect(http.calls[0]).toMatchObject({
      url: "https://registry.acme.test/.well-known/ard.json",
      method: "GET",
      headers: { Authorization: "Bearer acme-token" },
    });
    expect(listing.outcome).toBe("listed");
    if (listing.outcome !== "listed") return;
    expect(listing.items).toHaveLength(1);
    expect(listing.items[0]).toEqual({
      rawAgentId: "urn:air:registry.acme.test:agent:triage",
      displayText: "triage",
      metadata: {
        platform: "ard",
        tags: JSON.stringify({ team: "support" }),
        matchIds: JSON.stringify(["urn:air:registry.acme.test:agent:triage"]),
        owner: "support",
        model: "anthropic/claude-sonnet-5",
        version: "3",
        updatedAt: "2026-11-02T08:00:00.000Z",
      },
    });
  });

  /** @scenario "An ARD registry with a search endpoint is read page by page" */
  it("joins the manifest and every search page, each identifier once", async () => {
    const http = new ScriptedRegistry((call) => {
      if (call.method === "GET") return { status: 200, body: manifest([entry("a"), entry("b")]) };
      const request = JSON.parse(call.body ?? "{}") as { pageToken?: string };
      return request.pageToken === "2"
        ? { status: 200, body: { results: [{ ...entry("d"), score: 50, source: "x" }] } }
        : {
            status: 200,
            body: {
              results: [
                { ...entry("b"), score: 90, source: "x" },
                { ...entry("c"), score: 80, source: "x" },
              ],
              pageToken: "2",
            },
          };
    });
    const listing = await HttpArdRegistryChannel.create({ http }).listAgents({
      registryUrl: "https://registry.acme.test/some/path",
      searchUrl: "https://registry.acme.test/ard/search",
    });

    expect(listing.outcome).toBe("listed");
    if (listing.outcome !== "listed") return;
    expect(listing.items.map((agent) => agent.displayText)).toEqual(["a", "b", "c", "d"]);
    const searches = http.calls.filter((call) => call.method === "POST");
    expect(searches.map((call) => JSON.parse(call.body ?? "{}"))).toEqual([
      { query: { text: "*" }, pageSize: 100 },
      { query: { text: "*" }, pageSize: 100, pageToken: "2" },
    ]);
    expect(searches.every((call) => call.url === "https://registry.acme.test/ard/search")).toBe(
      true,
    );
  });

  /** @scenario "A manifest of another ARD version refuses as malformed" */
  it("refuses a manifest whose specVersion is not 0.91", async () => {
    const http = new ScriptedRegistry(() => ({
      status: 200,
      body: manifest([entry("triage")], "0.80"),
    }));
    const listing = await HttpArdRegistryChannel.create({ http }).listAgents({
      registryUrl: "registry.acme.test",
    });
    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "malformed_response", status: null },
    });
  });

  it("refuses a manifest that omits its entries as malformed, so nothing is marked gone", async () => {
    const { entries: _omitted, ...withoutEntries } = manifest([]);
    const http = new ScriptedRegistry(() => ({ status: 200, body: withoutEntries }));
    const listing = await HttpArdRegistryChannel.create({ http }).listAgents({
      registryUrl: "registry.acme.test",
    });
    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "malformed_response", status: null },
    });
  });

  it("refuses a search page that omits its results as malformed", async () => {
    const http = new ScriptedRegistry((call) =>
      call.method === "GET"
        ? { status: 200, body: manifest([entry("triage")]) }
        : { status: 200, body: {} },
    );
    const listing = await HttpArdRegistryChannel.create({ http }).listAgents({
      registryUrl: "registry.acme.test",
      searchUrl: "https://registry.acme.test/ard/search",
    });
    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "malformed_response", status: null },
    });
  });

  it("reads a registry status as the refusal it maps to", async () => {
    const http = new ScriptedRegistry(() => ({ status: 401, body: {} }));
    const listing = await HttpArdRegistryChannel.create({ http }).listAgents({
      registryUrl: "registry.acme.test",
    });
    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "unauthorized", status: 401 },
    });
  });

  it("refuses a search that repeats its page token as stalled", async () => {
    const http = new ScriptedRegistry((call) =>
      call.method === "GET"
        ? { status: 200, body: manifest([]) }
        : { status: 200, body: { results: [], pageToken: "1" } },
    );
    const listing = await HttpArdRegistryChannel.create({ http }).listAgents({
      registryUrl: "registry.acme.test",
      searchUrl: "https://registry.acme.test/ard/search",
    });
    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "pagination_stalled", status: null },
    });
  });
});
