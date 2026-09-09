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
import { describe, expect, it, vi } from "vitest";

import {
  agentsListed,
  agentsRefused,
  refusalFromStatus,
  refusalFromThrown,
} from "../agentListing";
import {
  copilotBotsAsAgents,
  listCopilotAgents,
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
});

/**
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 *
 * The listing and the transcript walk read the same table through the same
 * function and stop at different places on purpose. The walk wants a name for
 * the conversations it is about to map, and one it lacks costs that
 * conversation a label. This is the list itself, and an agent it stops short
 * of shows its provider identifier everywhere a name is expected.
 */
describe("given a tenant holding more agents than one page returns", () => {
  const pageOf = (params: { rows: unknown[]; next?: string }) =>
    reply({
      ok: true,
      status: 200,
      body: {
        value: params.rows,
        ...(params.next === undefined
          ? {}
          : { "@odata.nextLink": params.next }),
      },
    });

  /** @scenario "The agent list follows the provider next-page link" */
  it("reads the following pages as well", async () => {
    fetchMock
      .mockResolvedValueOnce(
        pageOf({
          rows: [{ botid: "BOT-1", name: "Sales Copilot" }],
          next: "https://org1.crm.dynamics.com/page-2",
        }),
      )
      .mockResolvedValueOnce(
        pageOf({ rows: [{ botid: "BOT-2", name: "Support Copilot" }] }),
      );

    const listing = await listCopilotAgents({
      environmentUrl,
      token: "t",
      signal: undefined,
    });

    expect(listing.outcome).toBe("listed");
    if (listing.outcome !== "listed") return;
    expect(listing.items.map((item) => item.rawAgentId)).toEqual([
      "BOT-1",
      "BOT-2",
    ]);
  });

  /** @scenario "The agent list follows the provider next-page link" */
  it("leaves no agent showing an identifier in place of its name", async () => {
    fetchMock
      .mockResolvedValueOnce(
        pageOf({
          rows: [{ botid: "BOT-1", name: "Sales Copilot" }],
          next: "https://org1.crm.dynamics.com/page-2",
        }),
      )
      .mockResolvedValueOnce(
        pageOf({ rows: [{ botid: "BOT-2", name: "Support Copilot" }] }),
      );

    const listing = await listCopilotAgents({
      environmentUrl,
      token: "t",
      signal: undefined,
    });

    if (listing.outcome !== "listed") throw new Error("expected a listing");
    // The second page's agent used to be absent entirely, and absent is where
    // the raw identifier comes from: nothing downstream has a name to show.
    expect(listing.items.map((item) => item.displayText)).toEqual([
      "Sales Copilot",
      "Support Copilot",
    ]);
  });

  it("follows the provider's own link rather than one it rebuilt", async () => {
    // This case reads the recorded calls by position, and the mock is shared
    // across the file, so the count has to start here.
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        pageOf({
          rows: [{ botid: "BOT-1", name: "Sales Copilot" }],
          next: "https://org1.crm.dynamics.com/page-2?token=opaque",
        }),
      )
      .mockResolvedValueOnce(pageOf({ rows: [] }));

    await listCopilotAgents({ environmentUrl, token: "t", signal: undefined });

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://org1.crm.dynamics.com/page-2?token=opaque",
    );
  });

  it("stops the whole read when a page mid-walk refuses", async () => {
    fetchMock
      .mockResolvedValueOnce(
        pageOf({
          rows: [{ botid: "BOT-1", name: "Sales Copilot" }],
          next: "https://org1.crm.dynamics.com/page-2",
        }),
      )
      .mockResolvedValueOnce(reply({ ok: false, status: 403 }));

    const listing = await listCopilotAgents({
      environmentUrl,
      token: "t",
      signal: undefined,
    });

    // Reporting the first page alone would present a partial list as the
    // whole tenant, which is the failure this scenario exists to stop.
    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "unauthorized", status: 403 },
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
