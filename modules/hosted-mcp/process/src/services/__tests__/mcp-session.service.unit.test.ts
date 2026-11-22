/**
 * @vitest-environment node
 * @see modules/hosted-mcp/specs/hosted-mcp.feature
 */
import { initConfig, tryGetConfig } from "@langwatch/mcp-server/config";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { describe, expect, it, vi } from "vitest";

import { MemoryMcpSessionRepository } from "../../repositories/memory/memory.mcp-session.repository.ts";
import { McpSessionService } from "../mcp-session.service.ts";

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

function heldSession({ expiresAt }: { expiresAt?: number }) {
  const sessions = McpSessionService.create({
    records: MemoryMcpSessionRepository.create(),
    sessionTools: undefined,
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => "s-1" });
  const close = vi.spyOn(transport, "close");
  const session = sessions.openSession({
    transport,
    apiKey: "key-a",
    projectId: "project-1",
    userId: undefined,
    expiresAt,
  });
  sessions.streamable.set("s-1", session);
  return { sessions, session, close };
}

describe("given a session this replica holds", () => {
  describe("when it is opened", () => {
    /** @scenario "A session lasts 30 days from when it opened" */
    it("ends 30 days later, and a copy kept busy is still dropped at that moment", () => {
      const { sessions, session, close } = heldSession({});
      expect(session.expiresAt - Date.now()).toBeGreaterThan(THIRTY_DAYS_MS - 60_000);

      // Busy right up to the end: use never extends it.
      session.lastActivityAt = session.expiresAt;
      sessions.reapIdle(session.expiresAt);

      expect(sessions.streamable.has("s-1")).toBe(false);
      expect(close).toHaveBeenCalled();
    });
  });

  describe("when it was rebuilt from a record with ten seconds left", () => {
    it("keeps the record's end, not a fresh 30 days", () => {
      const end = Date.now() + 10_000;
      const { sessions, close } = heldSession({ expiresAt: end });

      sessions.reapIdle(end - 1);
      expect(sessions.streamable.has("s-1")).toBe(true);
      sessions.reapIdle(end);
      expect(sessions.streamable.has("s-1")).toBe(false);
      expect(close).toHaveBeenCalled();
    });
  });
});

describe("given a tool run for a session", () => {
  /** @scenario "The hosted MCP's own API calls are counted with client hosted-mcp" */
  it("runs it with the session's key, marked as the hosted MCP", async () => {
    initConfig({ endpoint: "https://app.langwatch.ai" });
    const { sessions } = heldSession({});

    const config = await sessions.runAs("key-a", async () => tryGetConfig());

    expect(config).toMatchObject({ apiKey: "key-a", hosted: true });
  });
});
