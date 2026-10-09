/**
 * @vitest-environment node
 * The `insights.*` procedures on the real tRPC runtime over the installed module and the
 * memory tier. Only the authorisation answer and the release flag are the test's.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import { deriveInsightInbox } from "@langwatch/insight-contract";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { nowInstant } from "@langwatch/time";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  filing,
  installInsight,
  type InstalledInsight,
  OTHER_PROJECT,
  PROJECT,
} from "../../app/__tests__/insight.fixture.ts";
import { insightTrpcTransport } from "../insight.trpc.ts";

type TestContext = { actor: { id: string } };

const MEMBER = "user-member";
const VIEW = ["analytics:view"];
const MANAGE = ["analytics:view", "analytics:manage"];
const SOURCE = { conversationId: "conversation-1", messageId: "message-1" };

let installed: InstalledInsight | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await installed?.stop();
  installed = undefined;
});

async function member({
  held,
  isEnabled = true,
}: {
  held: readonly string[];
  isEnabled?: boolean;
}) {
  installed = await installInsight({ isEnabled });
  const { app, gateAsks } = installed;
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();
  const caller = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({ permits: (permission) => held.includes(permission) }),
  })
    .mount(insightTrpcTransport, () => app)
    .createCaller({ actor: { id: MEMBER } });

  return { caller, app, gateAsks };
}

describe("given the insights tRPC family", () => {
  describe("when a member with analytics:manage saves a Langy answer as an insight", () => {
    /** @scenario "A member saves a Langy answer as an insight" */
    it("files it against the project with its Langy source, at the top of their inbox", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-08T07:00:00.000Z"));
      const { caller } = await member({ held: MANAGE });
      const earlier = await caller.file(filing({ title: "Latency is back to normal" }));
      vi.setSystemTime(new Date("2026-10-09T07:00:00.000Z"));

      const filed = await caller.file(
        filing({ title: "Checkout errors doubled", tone: "bad", source: SOURCE }),
      );

      const entries = await caller.getAll({ projectId: PROJECT });
      const { inbox } = deriveInsightInbox({ entries, now: nowInstant().epochMilliseconds });
      expect(inbox.map((entry) => entry.id)).toEqual([filed.id, earlier.id]);
      expect(inbox[0]).toMatchObject({
        title: "Checkout errors doubled",
        body: "Checkout errors doubled overnight.",
        tone: "bad",
        source: SOURCE,
        filedByUserId: MEMBER,
      });
      await expect(caller.getAll({ projectId: OTHER_PROJECT })).resolves.toEqual([]);
    });
  });

  describe("when a member with analytics:view but not analytics:manage files an insight", () => {
    /** @scenario "A viewer cannot file an insight" */
    it("refuses as forbidden before the handler runs, and files nothing", async () => {
      const { caller, gateAsks } = await member({ held: VIEW });

      await expect(caller.file(filing())).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(gateAsks).toEqual([]);
      await expect(caller.getAll({ projectId: PROJECT })).resolves.toEqual([]);
    });
  });

  describe("when the release_insights flag is off for the project", () => {
    /** @scenario "Insights are refused when the flag is off" */
    it("refuses a read of the project's insights with insights_not_enabled", async () => {
      const { caller } = await member({ held: MANAGE, isEnabled: false });

      await expect(caller.getAll({ projectId: PROJECT })).rejects.toMatchObject({
        cause: { code: "insights_not_enabled" },
      });
    });
  });

  describe("when a member marks done an insight the project does not have", () => {
    /** @scenario "Acting on an unknown insight is refused" */
    it("refuses with insight_not_found", async () => {
      const { caller } = await member({ held: VIEW });

      await expect(
        caller.archive({ projectId: PROJECT, insightId: "insight_unknown" }),
      ).rejects.toMatchObject({ cause: { code: "insight_not_found" } });
    });
  });

  describe("when a member of this project keeps an insight filed in another project", () => {
    /** @scenario "An insight from another project is not found" */
    it("refuses with insight_not_found", async () => {
      const { caller } = await member({ held: MANAGE });
      const elsewhere = await caller.file(filing({ projectId: OTHER_PROJECT }));

      await expect(
        caller.keep({ projectId: PROJECT, insightId: elsewhere.id }),
      ).rejects.toMatchObject({ cause: { code: "insight_not_found" } });
    });
  });

  describe("when a member without analytics:view asks for the project's insights", () => {
    /** @scenario "A member without analytics:view cannot read insights" */
    it("refuses as forbidden before the handler runs", async () => {
      const { caller, gateAsks } = await member({ held: [] });

      await expect(caller.getAll({ projectId: PROJECT })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      expect(gateAsks).toEqual([]);
    });
  });
});
