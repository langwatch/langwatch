// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The distinction this whole feature turns on: a provider that listed no agents
 * is not a provider that would not say.
 *
 * Before the listing type existed, `fetchBots` answered both with an empty Map
 * and the run reported success either way. That is right for a transcript pull
 * and wrong for a screen, so these cases assert the two never collapse again —
 * at the type, at the mappers, and at the two `fetch` boundaries.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  agentsListed,
  agentsRefused,
  refusalFromStatus,
  refusalFromThrown,
} from "../agentListing";
import {
  copilotBotsAsAgents,
  listCopilotAgents,
  MAX_BOT_PAGES,
  readBotRows,
  readCopilotBots,
} from "../copilotBots";
import { genieSpacesAsAgents, listGenieAgents } from "../genieSpaces";

vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: vi.fn(),
}));
const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
const fetchMock = vi.mocked(ssrfSafeFetch);

const reply = (params: { ok: boolean; status: number; body?: unknown }) =>
  ({
    ok: params.ok,
    status: params.status,
    statusText: "",
    json: async () => params.body ?? {},
  }) as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>;

const environmentUrl = "https://org1.crm.dynamics.com";
const workspaceUrl = "https://adb-1.azuredatabricks.net";

// The mock is module-level, so a queued `mockResolvedValueOnce` a case never
// consumed, or a persistent `mockResolvedValue`, is still installed for the
// next one. A paging case that counts requests reads those leftovers as its
// own, and a case asserting a refusal can be answered by someone else's reply.
beforeEach(() => {
  fetchMock.mockReset();
});

describe("agent listing outcomes", () => {
  describe("given a provider that listed none", () => {
    it("is a different outcome from a provider that refused", () => {
      const empty = agentsListed([]);
      const refused = agentsRefused({ reason: "unauthorized", status: 403 });

      expect(empty.outcome).toBe("empty");
      expect(refused.outcome).toBe("refused");
      expect(empty.outcome).not.toBe(refused.outcome);
    });

    it("carries no agents to read, so a caller cannot count them as zero", () => {
      const refused = agentsRefused({ reason: "unauthorized", status: 403 });
      expect(refused).not.toHaveProperty("items");
    });
  });

  describe("when a status is classified", () => {
    it("separates a credential problem from a busy provider", () => {
      expect(refusalFromStatus(403).reason).toBe("unauthorized");
      expect(refusalFromStatus(401).reason).toBe("unauthorized");
      expect(refusalFromStatus(404).reason).toBe("not_found");
      expect(refusalFromStatus(429).reason).toBe("rate_limited");
      expect(refusalFromStatus(503).reason).toBe("unavailable");
      // Unmapped falls to unavailable, with the status still attached so the
      // log can say which one it was.
      expect(refusalFromStatus(418)).toEqual({
        reason: "unavailable",
        status: 418,
      });
    });

    it("never carries the provider's own text", () => {
      const thrown = refusalFromThrown(
        new Error("token=sk-live-secret leaked in a fetch url"),
      );
      expect(JSON.stringify(thrown)).not.toContain("sk-live-secret");
      expect(thrown).toEqual({ reason: "unreachable", status: null });
    });
  });
});

describe("listCopilotAgents", () => {
  describe("given the environment refuses the bot table", () => {
    it("reports a refusal rather than an empty tenant", async () => {
      fetchMock.mockResolvedValueOnce(reply({ ok: false, status: 403 }));

      const listing = await listCopilotAgents({
        environmentUrl,
        token: "t",
        signal: undefined,
      });

      expect(listing).toEqual({
        outcome: "refused",
        refusal: { reason: "unauthorized", status: 403 },
      });
    });
  });

  describe("given the environment answers with no agents", () => {
    it("reports an empty tenant", async () => {
      fetchMock.mockResolvedValueOnce(
        reply({ ok: true, status: 200, body: { value: [] } }),
      );

      const listing = await listCopilotAgents({
        environmentUrl,
        token: "t",
        signal: undefined,
      });

      expect(listing).toEqual({ outcome: "empty", items: [] });
    });
  });

  describe("given the environment lists agents", () => {
    it("maps them with the environment url in metadata", async () => {
      fetchMock.mockResolvedValueOnce(
        reply({
          ok: true,
          status: 200,
          body: {
            value: [
              {
                botid: "BOT-1",
                name: "Sales Copilot",
                modifiedon: "2026-08-01T00:00:00Z",
              },
            ],
          },
        }),
      );

      const listing = await listCopilotAgents({
        environmentUrl,
        token: "t",
        signal: undefined,
      });

      expect(listing).toEqual({
        outcome: "listed",
        items: [
          {
            // Verbatim, not folded: the folded form is a join key, not an id.
            rawAgentId: "BOT-1",
            displayText: "Sales Copilot",
            metadata: {
              environmentUrl,
              modifiedOn: "2026-08-01T00:00:00Z",
            },
          },
        ],
      });
    });
  });

  describe("given the transport fails outright", () => {
    it("reports unreachable, not an empty tenant", async () => {
      fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));

      const listing = await listCopilotAgents({
        environmentUrl,
        token: "t",
        signal: undefined,
      });

      expect(listing).toEqual({
        outcome: "refused",
        refusal: { reason: "unreachable", status: null },
      });
    });
  });
});

describe("readCopilotBots", () => {
  describe("given the walk and the listing read the same reply", () => {
    it("gives each caller what it needs from one request", async () => {
      fetchMock.mockResolvedValueOnce(
        reply({
          ok: true,
          status: 200,
          body: {
            value: [{ botid: "BOT-1", name: "Sales Copilot" }],
            "@odata.nextLink": "https://org1.crm.dynamics.com/next",
          },
        }),
      );

      const read = await readCopilotBots({ environmentUrl, token: "t" });
      expect(read.ok).toBe(true);
      if (!read.ok) return;

      // The walk folds the id to join on it; the listing keeps it verbatim.
      expect([...readBotRows(read.rows).keys()]).toEqual(["bot-1"]);
      expect(
        copilotBotsAsAgents({ rows: read.rows, environmentUrl })[0]?.rawAgentId,
      ).toBe("BOT-1");
      expect(read.hasMorePages).toBe(true);
    });
  });

  describe("given an environment address the adapter would have rejected", () => {
    // The listing path safeParses the config schema and calls straight through,
    // so validateConfig never runs and the schema accepts any URL. Without the
    // check at this boundary a plain http address puts the bearer token on the
    // wire in clear.
    it("sends no request to a plain http environment", async () => {
      const read = await readCopilotBots({
        environmentUrl: "http://org1.crm.dynamics.com",
        token: "t",
      });

      expect(read).toEqual({
        ok: false,
        refusal: { reason: "not_configured", status: null },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends no request to a host outside Power Platform", async () => {
      const read = await readCopilotBots({
        environmentUrl: "https://evildynamics.com",
        token: "t",
      });

      expect(read.ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("given the environment has more than one page of bots", () => {
    it("walks to the end when the caller asked for every page", async () => {
      fetchMock
        .mockResolvedValueOnce(
          reply({
            ok: true,
            status: 200,
            body: {
              value: [{ botid: "BOT-1", name: "Sales Copilot" }],
              "@odata.nextLink": `${environmentUrl}/api/data/v9.2/bots?$skiptoken=2`,
            },
          }),
        )
        .mockResolvedValueOnce(
          reply({
            ok: true,
            status: 200,
            body: { value: [{ botid: "BOT-2", name: "Support Copilot" }] },
          }),
        );

      const read = await readCopilotBots({
        environmentUrl,
        token: "t",
        shouldFollowPages: true,
      });

      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(
        copilotBotsAsAgents({ rows: read.rows, environmentUrl }).map(
          (a) => a.rawAgentId,
        ),
      ).toEqual(["BOT-1", "BOT-2"]);
      expect(read.hasMorePages).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("reads one page when the caller did not ask for more", async () => {
      fetchMock.mockResolvedValue(
        reply({
          ok: true,
          status: 200,
          body: {
            value: [{ botid: "BOT-1" }],
            "@odata.nextLink": `${environmentUrl}/next`,
          },
        }),
      );

      const read = await readCopilotBots({ environmentUrl, token: "t" });

      expect(read.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // The continuation URL arrives in the response body and the next request
    // carries the token, so following one off-origin would hand the credential
    // to whoever answers.
    it("refuses rather than follow a link off the environment", async () => {
      fetchMock.mockResolvedValueOnce(
        reply({
          ok: true,
          status: 200,
          body: {
            value: [{ botid: "BOT-1" }],
            "@odata.nextLink": "https://attacker.example.com/next",
          },
        }),
      );

      const read = await readCopilotBots({
        environmentUrl,
        token: "t",
        shouldFollowPages: true,
      });

      expect(read).toEqual({
        ok: false,
        refusal: { reason: "malformed_response", status: null },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("listCopilotAgents paging", () => {
  describe("given the environment holds more agents than the walk could read", () => {
    it("refuses rather than present a first page as the inventory", async () => {
      // Every page carries a link, so the walk spends its budget and still has
      // somewhere to go. Pressing Sync again would start at this same first
      // page, so the missing agents are not discoverable by repeating it.
      fetchMock.mockResolvedValue(
        reply({
          ok: true,
          status: 200,
          body: {
            value: [{ botid: "BOT-1" }],
            "@odata.nextLink": `${environmentUrl}/api/data/v9.2/bots?$skiptoken=x`,
          },
        }),
      );

      const listing = await listCopilotAgents({ environmentUrl, token: "t" });

      // `too_many_pages` rather than `unavailable`: every request in that walk
      // came back 200, so nothing upstream misbehaved and the bound that
      // stopped it is ours. The distinction is what stops the screen telling
      // this reader to ask again.
      expect(listing).toEqual({
        outcome: "refused",
        refusal: { reason: "too_many_pages", status: null },
      });
      expect(fetchMock).toHaveBeenCalledTimes(MAX_BOT_PAGES);
    });
  });
});

describe("listGenieAgents", () => {
  describe("given the workspace refuses to enumerate", () => {
    it("reports a refusal rather than a workspace with no spaces", async () => {
      fetchMock.mockResolvedValueOnce(reply({ ok: false, status: 403 }));

      const listing = await listGenieAgents({ workspaceUrl, token: "t" });

      expect(listing).toEqual({
        outcome: "refused",
        refusal: { reason: "unauthorized", status: 403 },
      });
    });
  });

  describe("given the workspace holds more spaces than the walk could read", () => {
    it("refuses rather than present the pages it managed as the inventory", async () => {
      // Every page hands back a fresh token, so the walk is cut short by its
      // own page bound rather than by reaching the end.
      let token = 0;
      fetchMock.mockImplementation(() => {
        token += 1;
        return Promise.resolve(
          reply({
            ok: true,
            status: 200,
            body: {
              spaces: [{ space_id: `space-${token}`, title: `Space ${token}` }],
              next_page_token: `tok-${token}`,
            },
          }),
        );
      });

      const listing = await listGenieAgents({ workspaceUrl, token: "t" });

      // Same reasoning as the Copilot bound above: the workspace answered
      // every page it was asked for, so this is our limit and not its fault.
      expect(listing).toEqual({
        outcome: "refused",
        refusal: { reason: "too_many_pages", status: null },
      });
    });
  });

  describe("given the workspace enumerates no spaces", () => {
    it("reports an empty workspace", async () => {
      fetchMock.mockResolvedValueOnce(
        reply({ ok: true, status: 200, body: { spaces: [] } }),
      );

      const listing = await listGenieAgents({ workspaceUrl, token: "t" });

      expect(listing).toEqual({ outcome: "empty", items: [] });
    });
  });

  describe("given the workspace lists spaces across two pages", () => {
    it("walks both and carries the workspace host in metadata", async () => {
      fetchMock
        .mockResolvedValueOnce(
          reply({
            ok: true,
            status: 200,
            body: {
              spaces: [{ space_id: "s1", title: "Revenue Analyst" }],
              next_page_token: "p2",
            },
          }),
        )
        .mockResolvedValueOnce(
          reply({
            ok: true,
            status: 200,
            body: { spaces: [{ space_id: "s2", title: null }] },
          }),
        );

      const listing = await listGenieAgents({ workspaceUrl, token: "t" });

      expect(listing).toEqual({
        outcome: "listed",
        items: [
          {
            rawAgentId: "s1",
            displayText: "Revenue Analyst",
            metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
          },
          {
            // A space with no title falls back to its id rather than to "".
            rawAgentId: "s2",
            displayText: "s2",
            metadata: { workspaceHost: "adb-1.azuredatabricks.net" },
          },
        ],
      });
    });
  });

  describe("given the workspace answers a page it already served", () => {
    it("refuses to loop and reports unreachable", async () => {
      fetchMock.mockResolvedValue(
        reply({
          ok: true,
          status: 200,
          body: {
            spaces: [{ space_id: "s1", title: "A" }],
            next_page_token: "same",
          },
        }),
      );

      const listing = await listGenieAgents({ workspaceUrl, token: "t" });

      expect(listing.outcome).toBe("refused");
    });
  });
});

describe("genieSpacesAsAgents", () => {
  describe("given two sources point at one workspace by different addresses", () => {
    it("records the same host for both", () => {
      const withSlash = genieSpacesAsAgents({
        spaces: [{ space_id: "s1", title: "A" }],
        workspaceUrl: "https://adb-1.azuredatabricks.net/",
      });
      const without = genieSpacesAsAgents({
        spaces: [{ space_id: "s1", title: "A" }],
        workspaceUrl: "https://adb-1.azuredatabricks.net",
      });

      expect(withSlash[0]?.metadata).toEqual(without[0]?.metadata);
    });
  });
});

describe("copilotBotsAsAgents", () => {
  describe("given a row without modifiedon", () => {
    it("omits the key rather than blanking it", () => {
      const agents = copilotBotsAsAgents({
        rows: [{ botid: "BOT-1", name: "Sales Copilot" }],
        environmentUrl,
      });

      // An absent key is what makes the repository's merge keep the last
      // known value; a null would be a claim the provider never made.
      expect(agents[0]?.metadata).toEqual({ environmentUrl });
      expect(agents[0]?.metadata).not.toHaveProperty("modifiedOn");
    });
  });

  describe("given a row the schema cannot read", () => {
    it("drops that row and keeps the rest", () => {
      const agents = copilotBotsAsAgents({
        rows: [{ botid: 42 }, { botid: "BOT-2", name: "Support" }],
        environmentUrl,
      });

      expect(agents.map((a) => a.rawAgentId)).toEqual(["BOT-2"]);
    });
  });
});
