import { describe, expect, it } from "vitest";

import { HttpSlackWebApiChannel } from "../http.slack-web-api.channel.ts";

describe("HttpSlackWebApiChannel", () => {
  /** @scenario "A bot token is checked against the configured Slack Web API" */
  it("asks auth.test of the configured API base", async () => {
    const urls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      urls.push(new Request(input).url);
      return new Response(JSON.stringify({ ok: true, team_id: "T0SIM", team: "Sim" }));
    };
    const channel = HttpSlackWebApiChannel.create({
      fetch,
      apiBase: "https://outbound.x.langwatch.localhost/api",
    });

    const result = await channel.fetchWorkspaceIdentity({ token: "xoxb-fake" });

    expect(urls).toEqual(["https://outbound.x.langwatch.localhost/api/auth.test"]);
    expect(result).toEqual({ ok: true, identity: { teamId: "T0SIM", teamName: "Sim" } });
  });
});
