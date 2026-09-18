import { describe, expect, it } from "vitest";
import {
  applyDevTunnel,
  DEV_SECRET_HEADER,
  deriveSimulationsUrl,
  restoreDevTunnel,
} from "../dev/write-back";

const TUNNEL_URL = "https://lively-otter.trycloudflare.com";

describe("applyDevTunnel()", () => {
  describe("when the agent points at a deployed URL", () => {
    /** @scenario "URL write-back replaces the agent URL and stashes the previous one" */
    it("replaces the URL and stashes the previous one under devTunnel", () => {
      const config = applyDevTunnel({
        config: { url: "https://staging.example.com/agent" },
        tunnelUrl: TUNNEL_URL,
        connectedAt: "2026-08-15T10:00:00.000Z",
      });

      // The platform posts to the agent URL verbatim, so the tunnel URL
      // keeps the previous URL's request path.
      expect(config.url).toBe(`${TUNNEL_URL}/agent`);
      expect(config.devTunnel).toEqual({
        previousUrl: "https://staging.example.com/agent",
        connectedAt: "2026-08-15T10:00:00.000Z",
      });
    });

    /** @scenario "URL write-back keeps the agent's request path on the tunnel URL" */
    it("keeps a bare tunnel URL when the previous URL has no path", () => {
      const config = applyDevTunnel({
        config: { url: "https://staging.example.com" },
        tunnelUrl: TUNNEL_URL,
      });

      expect(config.url).toBe(TUNNEL_URL);
    });

    it("carries the previous URL's query string too", () => {
      const config = applyDevTunnel({
        config: { url: "https://staging.example.com/agent/chat?tenant=acme" },
        tunnelUrl: `${TUNNEL_URL}/`,
      });

      expect(config.url).toBe(`${TUNNEL_URL}/agent/chat?tenant=acme`);
    });
  });

  describe("when a crashed session left a stale tunnel on the agent", () => {
    /** @scenario "A second session over a stale tunnel keeps the original previous URL" */
    it("stashes the original previous URL, not the dead tunnel URL", () => {
      const config = applyDevTunnel({
        config: {
          url: "https://dead-session.trycloudflare.com",
          devTunnel: {
            previousUrl: "https://staging.example.com/agent",
            connectedAt: "2026-08-14T10:00:00.000Z",
          },
        },
        tunnelUrl: TUNNEL_URL,
      });

      expect(config.url).toBe(`${TUNNEL_URL}/agent`);
      expect(
        (config.devTunnel as { previousUrl?: string }).previousUrl,
      ).toBe("https://staging.example.com/agent");
    });
  });

  describe("when a secret is minted for the session", () => {
    /** @scenario "The session secret header row is replaced, never duplicated" */
    it("replaces an existing dev-secret header row instead of appending", () => {
      const config = applyDevTunnel({
        config: {
          url: "https://staging.example.com/agent",
          headers: [
            { key: "Authorization", value: "Bearer customer-token" },
            { key: DEV_SECRET_HEADER, value: "stale-secret" },
          ],
        },
        tunnelUrl: TUNNEL_URL,
        secret: "fresh-secret",
      });

      const headers = config.headers as { key: string; value: string }[];
      const secretRows = headers.filter((h) => h.key === DEV_SECRET_HEADER);
      expect(secretRows).toEqual([
        { key: DEV_SECRET_HEADER, value: "fresh-secret" },
      ]);
      expect(headers).toContainEqual({
        key: "Authorization",
        value: "Bearer customer-token",
      });
    });
  });

  describe("when the session runs without the auth proxy", () => {
    it("removes any stale dev-secret header row", () => {
      const config = applyDevTunnel({
        config: {
          url: "https://staging.example.com/agent",
          headers: [{ key: DEV_SECRET_HEADER, value: "stale-secret" }],
        },
        tunnelUrl: TUNNEL_URL,
      });

      expect(config.headers).toEqual([]);
    });
  });
});

describe("restoreDevTunnel()", () => {
  describe("when the agent carries a devTunnel stash", () => {
    /** @scenario "Ending the session restores the agent and clears the tunnel marker" */
    it("restores the previous URL, drops devTunnel, and removes the secret header", () => {
      const restored = restoreDevTunnel({
        config: {
          url: TUNNEL_URL,
          headers: [
            { key: "Authorization", value: "Bearer customer-token" },
            { key: DEV_SECRET_HEADER, value: "session-secret" },
          ],
          devTunnel: {
            previousUrl: "https://staging.example.com/agent",
            connectedAt: "2026-08-15T10:00:00.000Z",
          },
        },
      });

      expect(restored).not.toBeNull();
      expect(restored?.url).toBe("https://staging.example.com/agent");
      expect(restored?.devTunnel).toBeUndefined();
      expect(restored?.headers).toEqual([
        { key: "Authorization", value: "Bearer customer-token" },
      ]);
    });
  });

  describe("when the agent carries no devTunnel stash", () => {
    it("returns null so a second restore is a no-op", () => {
      const restored = restoreDevTunnel({
        config: { url: "https://staging.example.com/agent" },
      });

      expect(restored).toBeNull();
    });
  });
});

describe("deriveSimulationsUrl()", () => {
  it("derives the project simulations page from the agent platform URL", () => {
    expect(
      deriveSimulationsUrl(
        "https://app.langwatch.ai/my-project/agents?drawer.open=agentHttpEditor&drawer.agentId=agent_abc123",
      ),
    ).toBe("https://app.langwatch.ai/my-project/simulations");
  });

  it("returns undefined for an absent or unparseable URL", () => {
    expect(deriveSimulationsUrl(undefined)).toBeUndefined();
    expect(deriveSimulationsUrl("not a url")).toBeUndefined();
  });
});
