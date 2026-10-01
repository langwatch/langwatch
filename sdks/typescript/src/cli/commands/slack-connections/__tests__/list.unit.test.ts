import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import { listSlackConnectionsCommand } from "../list";

const connections = [
  {
    id: "conn_bot",
    name: "Alerts bot",
    kind: "bot",
    scopeType: "ORGANIZATION",
    scopeId: "org_1",
    scopeName: "Acme",
    slackTeamName: "Acme Workspace",
    createdAt: "2026-09-01T00:00:00.000Z",
  },
];

describe("listSlackConnectionsCommand()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => connections });
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.LANGWATCH_API_KEY = "test-key";
    process.env.LANGWATCH_ENDPOINT = "http://localhost:5560";
  });

  /** @scenario "The command line lists Slack connections by name" */
  it("prints each connection's name, kind, scope and id, and hands JSON the API's answer", async () => {
    const result = await listSlackConnectionsCommand();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/slack-connections"),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer test-key" }),
      }),
    );
    expect(result?.data).toEqual(connections);

    result?.table?.();
    const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
    for (const text of ["Alerts bot", "conn_bot", "bot", "organization: Acme"]) {
      expect(printed).toContain(text);
    }
  });
});
