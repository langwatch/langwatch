/**
 * @vitest-environment node
 * The `insights.*` procedures on the real tRPC runtime over the installed module and the
 * memory tier: what a member files and reads, and what another member of the same project is
 * answered. Only the authorisation answer and the release flag are the test's.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import { deriveInsightInbox, INSIGHT_EVENT_TYPES } from "@langwatch/insight-contract";
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

const OWNER = "user-owner";
const OTHER = "user-other";
const VIEW = ["analytics:view"];
const SOURCE = { conversationId: "conversation-1", messageId: "message-1" };
const QUERY = "SELECT count() FROM traces";
const REPLAY = {
  start: Date.UTC(2026, 6, 5),
  end: Date.UTC(2026, 7, 4),
  granularitySeconds: 86_400,
  period: "Last 30 days",
  parameters: {},
};

let installed: InstalledInsight | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await installed?.stop();
  installed = undefined;
});

/** One installed module, and a caller on it for each member a test names. */
async function project({ isEnabled = true }: { isEnabled?: boolean } = {}) {
  installed = await installInsight({ isEnabled });
  const { app, gateAsks, eventTypesOf } = installed;

  const as = ({ userId, held = VIEW }: { userId: string; held?: readonly string[] }) => {
    const trpc = TrpcRootDefinition.forContext<TestContext>().create();
    return createTrpcRuntime<TestContext>({
      root: trpc,
      procedure: trpc.procedure,
      members: trpcTestMembers<TestContext>({ permits: (permission) => held.includes(permission) }),
    })
      .mount(insightTrpcTransport, () => app)
      .createCaller({ actor: { id: userId } });
  };

  return { as, gateAsks, eventTypesOf };
}

/** What a caller is told when a request is refused: the wire code and the handled error. */
async function refusalOf(request: Promise<unknown>) {
  const refusal: unknown = await request.then(
    () => {
      throw new Error("The request was not refused");
    },
    (error: unknown) => error,
  );
  if (!(refusal instanceof Error)) throw new Error("The refusal is not an error");
  const cause: unknown = refusal.cause;
  const handled = typeof cause === "object" && cause !== null ? cause : {};
  return {
    code: "code" in refusal ? refusal.code : undefined,
    message: refusal.message,
    cause: {
      code: "code" in handled ? handled.code : undefined,
      message: "message" in handled ? handled.message : undefined,
      httpStatus: "httpStatus" in handled ? handled.httpStatus : undefined,
    },
  };
}

describe("given the insights tRPC family", () => {
  describe("when a member with analytics:view saves a Langy answer as an insight", () => {
    /** @scenario "A member saves a Langy answer as an insight" */
    it("files it in the project as theirs, with its Langy source, at the top of their inbox", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-08T07:00:00.000Z"));
      const owner = (await project()).as({ userId: OWNER });
      const earlier = await owner.file(filing({ title: "Latency is back to normal" }));
      vi.setSystemTime(new Date("2026-10-09T07:00:00.000Z"));

      const filed = await owner.file(
        filing({ title: "Checkout errors doubled", tone: "bad", source: SOURCE }),
      );

      const entries = await owner.getAll({ projectId: PROJECT });
      const { inbox } = deriveInsightInbox({ entries, now: nowInstant().epochMilliseconds });
      expect(filed.ownerUserId).toBe(OWNER);
      expect(inbox.map((entry) => entry.id)).toEqual([filed.id, earlier.id]);
      expect(inbox[0]).toMatchObject({
        title: "Checkout errors doubled",
        body: "Checkout errors doubled overnight.",
        tone: "bad",
        source: SOURCE,
        ownerUserId: OWNER,
        filedByUserId: OWNER,
      });
      await expect(owner.getAll({ projectId: OTHER_PROJECT })).resolves.toEqual([]);
    });
  });

  describe("when a member without analytics:view files an insight", () => {
    /** @scenario "A member without analytics:view cannot file an insight" */
    it("refuses as forbidden before the handler runs, and files nothing", async () => {
      const { as, gateAsks } = await project();

      await expect(as({ userId: OWNER, held: [] }).file(filing())).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      expect(gateAsks).toEqual([]);
      await expect(as({ userId: OWNER }).getAll({ projectId: PROJECT })).resolves.toEqual([]);
    });
  });

  describe("when the release_insights flag is off for the project", () => {
    /** @scenario "Insights are refused when the flag is off" */
    it("refuses a read of the caller's insights with insights_not_enabled", async () => {
      const owner = (await project({ isEnabled: false })).as({ userId: OWNER });

      await expect(owner.getAll({ projectId: PROJECT })).rejects.toMatchObject({
        cause: { code: "insights_not_enabled" },
      });
    });
  });

  describe("when a member marks done an insight the project does not have", () => {
    /** @scenario "Acting on an unknown insight is refused" */
    it("refuses with insight_not_found", async () => {
      const owner = (await project()).as({ userId: OWNER });

      await expect(
        owner.archive({ projectId: PROJECT, insightId: "insight_unknown" }),
      ).rejects.toMatchObject({ cause: { code: "insight_not_found" } });
    });
  });

  describe("when a member of this project keeps an insight filed in another project", () => {
    /** @scenario "An insight from another project is not found" */
    it("refuses with insight_not_found, though the insight is their own", async () => {
      const owner = (await project()).as({ userId: OWNER });
      const elsewhere = await owner.file(filing({ projectId: OTHER_PROJECT }));

      await expect(
        owner.keep({ projectId: PROJECT, insightId: elsewhere.id }),
      ).rejects.toMatchObject({ cause: { code: "insight_not_found" } });
    });
  });

  describe("when a member without analytics:view asks for their insights", () => {
    /** @scenario "A member without analytics:view cannot read insights" */
    it("refuses as forbidden before the handler runs", async () => {
      const { as, gateAsks } = await project();

      await expect(
        as({ userId: OWNER, held: [] }).getAll({ projectId: PROJECT }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(gateAsks).toEqual([]);
    });
  });
});

describe("given a member filed an insight with a query and a window", () => {
  describe("when another member of the project asks for their insights", () => {
    /** @scenario "Another member's inbox does not hold the insight" */
    it("answers no insight, so no title, no query, no window and nothing unseen", async () => {
      const { as } = await project();
      const filed = await as({ userId: OWNER }).file(filing({ lwql: QUERY, replay: REPLAY }));

      const theirs = await as({ userId: OTHER }).getAll({ projectId: PROJECT });

      expect(theirs).toEqual([]);
      expect(deriveInsightInbox({ entries: theirs, now: nowInstant().epochMilliseconds })).toEqual({
        inbox: [],
        stale: [],
        archived: [],
        unseen: [],
        count: 0,
        tone: "good",
      });
      // The owner still reads the evidence the other member was never handed.
      await expect(as({ userId: OWNER }).getAll({ projectId: PROJECT })).resolves.toEqual([
        expect.objectContaining({ id: filed.id, lwql: QUERY, replay: REPLAY }),
      ]);
    });
  });
});

describe("given a member filed an insight", () => {
  describe("when another member of the project marks it done, then keeps it", () => {
    /** @scenario "Another member's insight answers as an unknown one" */
    it("refuses each as it refuses an id no insight has, and moves nothing for the owner", async () => {
      const { as, eventTypesOf } = await project();
      const owner = as({ userId: OWNER });
      const other = as({ userId: OTHER });
      const { id: insightId } = await owner.file(filing());
      const unknown = { projectId: PROJECT, insightId: "insight_unknown" };
      const theirs = { projectId: PROJECT, insightId };

      const refusals = {
        archiveTheirs: await refusalOf(other.archive(theirs)),
        archiveUnknown: await refusalOf(other.archive(unknown)),
        keepTheirs: await refusalOf(other.keep(theirs)),
        keepUnknown: await refusalOf(other.keep(unknown)),
      };

      expect(refusals.archiveUnknown.cause).toEqual({
        code: "insight_not_found",
        message: "Insight not found.",
        httpStatus: 404,
      });
      expect(refusals.archiveTheirs).toEqual(refusals.archiveUnknown);
      expect(refusals.keepTheirs).toEqual(refusals.keepUnknown);
      expect(refusals.keepTheirs).toEqual(refusals.archiveUnknown);
      // Nothing of the other member's reached the stream: the filing, and the owner's own seen.
      expect(await eventTypesOf(theirs)).toEqual([
        INSIGHT_EVENT_TYPES.FILED,
        INSIGHT_EVENT_TYPES.SEEN,
      ]);
      await expect(owner.getAll({ projectId: PROJECT })).resolves.toEqual([
        expect.objectContaining({ id: insightId, archivedAt: null, keptAt: null }),
      ]);
    });
  });

  describe("when another member of the project marks it seen", () => {
    /** @scenario "Marking another member's insight seen records nothing" */
    it("answers as it does for an id no insight has, and records no seen event", async () => {
      const { as, eventTypesOf } = await project();
      const { id: insightId } = await as({ userId: OWNER }).file(filing());
      const other = as({ userId: OTHER });

      const theirs = await other.markSeen({ projectId: PROJECT, insightIds: [insightId] });
      const unknown = await other.markSeen({ projectId: PROJECT, insightIds: ["insight_unknown"] });

      expect(theirs).toEqual(unknown);
      expect(await eventTypesOf({ projectId: PROJECT, insightId })).toEqual([
        INSIGHT_EVENT_TYPES.FILED,
        INSIGHT_EVENT_TYPES.SEEN,
      ]);
      await expect(other.getAll({ projectId: PROJECT })).resolves.toEqual([]);
    });
  });

  describe("when they lose analytics:view on the project", () => {
    /** @scenario "An owner who lost analytics:view reads nothing" */
    it("refuses their reads and their acts as forbidden, before the handler runs", async () => {
      const { as, gateAsks } = await project();
      const { id: insightId } = await as({ userId: OWNER }).file(filing());
      const asksBefore = [...gateAsks];
      const demoted = as({ userId: OWNER, held: [] });
      const scope = { projectId: PROJECT, insightId };

      const requests = [
        demoted.getAll({ projectId: PROJECT }),
        demoted.markSeen({ projectId: PROJECT, insightIds: [insightId] }),
        demoted.archive(scope),
        demoted.keep(scope),
      ];

      for (const request of requests) {
        await expect(request).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      expect(gateAsks).toEqual(asksBefore);
    });
  });
});
