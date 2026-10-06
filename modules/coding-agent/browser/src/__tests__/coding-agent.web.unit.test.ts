/** @vitest-environment jsdom */

import { createUi } from "@langwatch/browser";
import {
  CodingAgentPullRequestsTableToken,
  CodingAgentSessionsTableToken,
} from "@langwatch/coding-agent-contract";
import { describe, expect, it } from "vitest";

import { codingAgentWeb } from "../coding-agent.web.ts";

function browserDocument() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return document;
}

describe("given a browser that installs coding-agent", () => {
  describe("when the kernel renders with no screen requirement to satisfy", () => {
    it("installs the module", async () => {
      const installed = await createUi({ document: browserDocument(), mount: "root" })
        .withModules([codingAgentWeb] as const)
        .render();

      expect(installed.modules).toContain(codingAgentWeb);
    });
  });

  describe("when user's workspace reads a lent activity table", () => {
    it.each([
      ["pull requests", CodingAgentPullRequestsTableToken],
      ["sessions", CodingAgentSessionsTableToken],
    ] as const)("loads the %s table under its token", async (_name, token) => {
      const lend = codingAgentWeb.installation.lends.find(
        ({ token: lent }) => lent.key === token.key,
      );
      const loaded = lend && "load" in lend ? await lend.load() : undefined;

      expect(loaded).toMatchObject({ default: expect.any(Function) });
    });
  });
});
