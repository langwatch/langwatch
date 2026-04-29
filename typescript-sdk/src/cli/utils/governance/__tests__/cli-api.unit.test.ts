import { describe, it, expect, vi } from "vitest";

import {
  GovernanceCliError,
  getCliBootstrap,
  getEventsForSource,
  getGovernanceStatus,
  getSourceHealth,
  listIngestionSources,
} from "../cli-api";
import type { GovernanceConfig } from "../config";

const baseCfg = (token: string | undefined = "at_x"): GovernanceConfig => ({
  gateway_url: "http://gw.example",
  control_plane_url: "http://app.example",
  access_token: token,
});

const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const status = (code: number, body?: unknown): Response =>
  new Response(body ? JSON.stringify(body) : "", {
    status: code,
    headers: body ? { "Content-Type": "application/json" } : undefined,
  });

interface SeenCall {
  url: string;
  authHeader: string | undefined;
  acceptHeader: string | undefined;
}

function spyFetch(response: Response): {
  fetchImpl: typeof fetch;
  seen: SeenCall[];
} {
  const seen: SeenCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({
      url,
      authHeader: headers.Authorization,
      acceptHeader: headers.Accept,
    });
    return response;
  };
  return { fetchImpl, seen };
}

describe("cli-api — auth contract", () => {
  describe("when access_token is missing", () => {
    it("throws GovernanceCliError(401, not_logged_in) without ever calling fetch", async () => {
      const fetchImpl = vi.fn();
      const cfgNoToken: GovernanceConfig = {
        ...baseCfg(),
        access_token: undefined,
      };
      await expect(
        listIngestionSources(cfgNoToken, { fetchImpl }),
      ).rejects.toMatchObject({
        name: "GovernanceCliError",
        status: 401,
        code: "not_logged_in",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("when the server returns 401", () => {
    it("throws GovernanceCliError(401, unauthorized) with a re-login hint", async () => {
      const { fetchImpl } = spyFetch(status(401, { error: "unauthorized" }));
      await expect(
        getGovernanceStatus(baseCfg(), { fetchImpl }),
      ).rejects.toMatchObject({
        name: "GovernanceCliError",
        status: 401,
        code: "unauthorized",
      });
    });
  });

  describe("when the server returns 404 with an error_description", () => {
    it("surfaces the description verbatim", async () => {
      const { fetchImpl } = spyFetch(
        status(404, {
          error: "not_found",
          error_description: "IngestionSource not found",
        }),
      );
      await expect(
        getSourceHealth(baseCfg(), "missing-id", { fetchImpl }),
      ).rejects.toMatchObject({
        name: "GovernanceCliError",
        status: 404,
        message: "IngestionSource not found",
      });
    });

    it("falls back to a generic message if the body has no description", async () => {
      const { fetchImpl } = spyFetch(status(404));
      await expect(
        getSourceHealth(baseCfg(), "missing-id", { fetchImpl }),
      ).rejects.toMatchObject({
        name: "GovernanceCliError",
        status: 404,
        message: "Not found",
      });
    });
  });

  describe("when the server returns 5xx", () => {
    it("throws with the status code in the message", async () => {
      const { fetchImpl } = spyFetch(status(503, "service unavailable"));
      const err = await getGovernanceStatus(baseCfg(), { fetchImpl }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(GovernanceCliError);
      expect((err as GovernanceCliError).status).toBe(503);
      expect((err as GovernanceCliError).message).toContain("503");
    });
  });
});

describe("cli-api — request shape", () => {
  describe("listIngestionSources", () => {
    it("hits /api/auth/cli/governance/ingest/sources without query params by default", async () => {
      const { fetchImpl, seen } = spyFetch(ok({ sources: [] }));
      await listIngestionSources(baseCfg(), { fetchImpl });
      expect(seen).toHaveLength(1);
      expect(seen[0]!.url).toBe(
        "http://app.example/api/auth/cli/governance/ingest/sources",
      );
    });

    it("appends ?include_archived=1 when includeArchived is set", async () => {
      const { fetchImpl, seen } = spyFetch(ok({ sources: [] }));
      await listIngestionSources(baseCfg(), {
        fetchImpl,
        includeArchived: true,
      });
      expect(seen[0]!.url).toBe(
        "http://app.example/api/auth/cli/governance/ingest/sources?include_archived=1",
      );
    });

    it("sends Bearer auth + Accept JSON headers", async () => {
      const { fetchImpl, seen } = spyFetch(ok({ sources: [] }));
      await listIngestionSources(baseCfg("at_TOKEN"), { fetchImpl });
      expect(seen[0]!.authHeader).toBe("Bearer at_TOKEN");
      expect(seen[0]!.acceptHeader).toBe("application/json");
    });

    it("unwraps the {sources:[...]} envelope to a bare array", async () => {
      const fixture = [
        {
          id: "src-1",
          name: "Source 1",
          sourceType: "otel_generic",
          description: null,
          status: "active",
          lastEventAt: "2026-04-27T00:00:00.000Z",
          createdAt: "2026-04-26T00:00:00.000Z",
          archivedAt: null,
        },
      ];
      const { fetchImpl } = spyFetch(ok({ sources: fixture }));
      const sources = await listIngestionSources(baseCfg(), { fetchImpl });
      expect(sources).toEqual(fixture);
    });

    it("preserves trailing slash safety on control_plane_url", async () => {
      const { fetchImpl, seen } = spyFetch(ok({ sources: [] }));
      await listIngestionSources(
        { ...baseCfg(), control_plane_url: "http://app.example/" },
        { fetchImpl },
      );
      expect(seen[0]!.url).toBe(
        "http://app.example/api/auth/cli/governance/ingest/sources",
      );
    });
  });

  describe("getEventsForSource", () => {
    it("URL-encodes the sourceId in the path", async () => {
      const { fetchImpl, seen } = spyFetch(ok({ events: [] }));
      await getEventsForSource(baseCfg(), "src/with spaces", { fetchImpl });
      expect(seen[0]!.url).toBe(
        "http://app.example/api/auth/cli/governance/ingest/sources/src%2Fwith%20spaces/events",
      );
    });

    it("appends limit + before_iso query params when provided", async () => {
      const { fetchImpl, seen } = spyFetch(ok({ events: [] }));
      await getEventsForSource(baseCfg(), "src-1", {
        fetchImpl,
        limit: 25,
        beforeIso: "2026-04-27T00:00:00.000Z",
      });
      expect(seen[0]!.url).toContain("limit=25");
      expect(seen[0]!.url).toContain(
        "before_iso=2026-04-27T00%3A00%3A00.000Z",
      );
    });

    it("omits the query string entirely when neither flag is set", async () => {
      const { fetchImpl, seen } = spyFetch(ok({ events: [] }));
      await getEventsForSource(baseCfg(), "src-1", { fetchImpl });
      expect(seen[0]!.url).toBe(
        "http://app.example/api/auth/cli/governance/ingest/sources/src-1/events",
      );
    });

    it("unwraps the {events:[...]} envelope to a bare array", async () => {
      const fixture = [
        {
          eventId: "evt-1",
          eventType: "api.call",
          actor: "u@example",
          action: "chat_completion",
          target: "claude-3-5-sonnet",
          costUsd: 0.001,
          tokensInput: 10,
          tokensOutput: 20,
          eventTimestampIso: "2026-04-27T00:00:00.000Z",
          ingestedAtIso: "2026-04-27T00:00:01.000Z",
          rawPayload: "{}",
        },
      ];
      const { fetchImpl } = spyFetch(ok({ events: fixture }));
      const events = await getEventsForSource(baseCfg(), "src-1", { fetchImpl });
      expect(events).toEqual(fixture);
    });
  });

  describe("getSourceHealth", () => {
    it("hits the /:id/health endpoint and returns the {source, health} envelope verbatim", async () => {
      const fixture = {
        source: { id: "src-1", name: "Source 1", status: "active" },
        health: {
          events24h: 1,
          events7d: 5,
          events30d: 12,
          lastSuccessIso: "2026-04-27T00:00:00.000Z",
        },
      };
      const { fetchImpl, seen } = spyFetch(ok(fixture));
      const out = await getSourceHealth(baseCfg(), "src-1", { fetchImpl });
      expect(seen[0]!.url).toBe(
        "http://app.example/api/auth/cli/governance/ingest/sources/src-1/health",
      );
      expect(out).toEqual(fixture);
    });
  });

  describe("getGovernanceStatus", () => {
    it("hits /governance/status and returns the {setup} envelope", async () => {
      const fixture = {
        setup: {
          hasPersonalVKs: false,
          hasRoutingPolicies: false,
          hasIngestionSources: true,
          hasAnomalyRules: true,
          hasRecentActivity: true,
          governanceActive: true,
        },
      };
      const { fetchImpl, seen } = spyFetch(ok(fixture));
      const out = await getGovernanceStatus(baseCfg(), { fetchImpl });
      expect(seen[0]!.url).toBe(
        "http://app.example/api/auth/cli/governance/status",
      );
      expect(out).toEqual(fixture);
    });
  });

  describe("getCliBootstrap", () => {
    it("hits /api/auth/cli/bootstrap and returns the {providers, budget} payload", async () => {
      const fixture = {
        providers: [
          {
            name: "anthropic",
            displayName: "Anthropic",
            models: ["claude-sonnet-4", "claude-haiku-4-5"],
          },
          {
            name: "openai",
            displayName: "OpenAI",
            models: ["gpt-5", "gpt-5-mini"],
          },
        ],
        budget: {
          monthlyLimitUsd: 500,
          monthlyUsedUsd: 0,
          period: "MONTHLY",
        },
      };
      const { fetchImpl, seen } = spyFetch(ok(fixture));
      const out = await getCliBootstrap(baseCfg(), { fetchImpl });
      expect(seen[0]!.url).toBe(
        "http://app.example/api/auth/cli/bootstrap",
      );
      expect(seen[0]!.authHeader).toBe("Bearer at_x");
      expect(out).toEqual(fixture);
    });

    it("returns null on 404 — graceful degrade for older self-hosters without the REST adapter", async () => {
      const { fetchImpl } = spyFetch(status(404, { error_description: "Not found" }));
      const out = await getCliBootstrap(baseCfg(), { fetchImpl });
      expect(out).toBeNull();
    });

    it("propagates 401 unauthorized errors so the caller can surface a re-login hint", async () => {
      const { fetchImpl } = spyFetch(status(401));
      await expect(getCliBootstrap(baseCfg(), { fetchImpl })).rejects.toThrow(
        GovernanceCliError,
      );
    });

    it("propagates 5xx errors with the status in the message", async () => {
      const { fetchImpl } = spyFetch(status(500, { msg: "boom" }));
      await expect(getCliBootstrap(baseCfg(), { fetchImpl })).rejects.toThrow(
        /500/,
      );
    });
  });
});
