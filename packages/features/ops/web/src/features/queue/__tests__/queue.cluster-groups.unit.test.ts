import { describe, expect, it } from "vitest";
import { clusterGroups, middleEllipsis, splitIndexedSuffix } from "../../../index";

const TRACE =
  "project_LVYcVYGW1AJqvp2G8vcVd/command/recordSpan/trace:023eaa8bf3796bd67ac4e0498e984c2a";

const fanOut = (indexes: number[]) =>
  indexes.map((i) => ({
    queueName: "trace_processing",
    groupId: `${TRACE}:${i}`,
    pendingJobs: 1,
    oldestJobMs: 1_000 + i,
  }));

describe("clusterGroups", () => {
  describe("given a fan-out of one trace across many groups", () => {
    describe("when the rows are clustered", () => {
      /** @scenario "A fan-out collapses into one row per cluster" */
      it("collapses them to a single row", () => {
        const clusters = clusterGroups(fanOut([41, 52, 15, 11, 0]));

        expect(clusters).toHaveLength(1);
        expect(clusters[0]?.members).toHaveLength(5);
      });

      it("carries the aggregate pending count", () => {
        const clusters = clusterGroups(fanOut([1, 2, 3]));

        expect(clusters[0]?.totalPendingJobs).toBe(3);
      });

      it("reports the worst wait across members, not an average", () => {
        const clusters = clusterGroups(fanOut([5, 1, 9]));

        expect(clusters[0]?.oldestJobMs).toBe(1_001);
      });

      it("labels the cluster with the shared stem", () => {
        const clusters = clusterGroups(fanOut([1, 2]));

        expect(clusters[0]?.label).toBe(TRACE);
      });
    });
  });

  describe("given groups that share no stem", () => {
    describe("when the rows are clustered", () => {
      /** @scenario "Groups that share no prefix are not clustered" */
      it("leaves each on its own row", () => {
        const clusters = clusterGroups([
          {
            queueName: "trace_processing",
            groupId: "project_a/command/recordSpan/trace:aaa:1",
            pendingJobs: 1,
            oldestJobMs: 1,
          },
          {
            queueName: "evaluation_processing",
            groupId: "project_b/command/evaluate/run:bbb:1",
            pendingJobs: 2,
            oldestJobMs: 2,
          },
        ]);

        expect(clusters).toHaveLength(2);
      });
    });
  });

  describe("given the same stem in two different queues", () => {
    it("keeps them apart", () => {
      const clusters = clusterGroups([
        {
          queueName: "queue_a",
          groupId: "shared/stem:1",
          pendingJobs: 1,
          oldestJobMs: 1,
        },
        {
          queueName: "queue_b",
          groupId: "shared/stem:2",
          pendingJobs: 1,
          oldestJobMs: 1,
        },
      ]);

      expect(clusters).toHaveLength(2);
    });
  });

  describe("given clusters of differing weight", () => {
    it("orders the heaviest first", () => {
      const clusters = clusterGroups([
        {
          queueName: "q",
          groupId: "light/stem:1",
          pendingJobs: 1,
          oldestJobMs: 1,
        },
        {
          queueName: "q",
          groupId: "heavy/stem:1",
          pendingJobs: 40,
          oldestJobMs: 1,
        },
      ]);

      expect(clusters[0]?.totalPendingJobs).toBe(40);
    });
  });

  describe("given one indexed group with no sibling", () => {
    it("keeps the whole identifier, index included", () => {
      // Shortening to the stem before anything is collapsed into it drops the
      // one detail that tells this group apart from the sibling it does not
      // have yet.
      const clusters = clusterGroups([
        {
          queueName: "q",
          groupId: "solo/stem:7",
          pendingJobs: 1,
          oldestJobMs: 1,
        },
      ]);

      expect(clusters[0]?.label).toBe("solo/stem:7");
    });
  });

  describe("given a second member joining an indexed cluster", () => {
    it("collapses the label to the shared stem", () => {
      const clusters = clusterGroups([
        {
          queueName: "q",
          groupId: "pair/stem:1",
          pendingJobs: 1,
          oldestJobMs: 1,
        },
        {
          queueName: "q",
          groupId: "pair/stem:2",
          pendingJobs: 1,
          oldestJobMs: 1,
        },
      ]);

      expect(clusters[0]?.label).toBe("pair/stem");
      expect(clusters[0]?.members).toHaveLength(2);
    });
  });

  describe("given a group with no jobs at all", () => {
    it("reports no wait rather than a fabricated one", () => {
      const clusters = clusterGroups([
        {
          queueName: "q",
          groupId: "stem:1",
          pendingJobs: 0,
          oldestJobMs: null,
        },
      ]);

      expect(clusters[0]?.oldestJobMs).toBeNull();
    });
  });
});

describe("splitIndexedSuffix", () => {
  describe("given a trailing bare index", () => {
    it("splits it off", () => {
      expect(splitIndexedSuffix("a/b:41")).toEqual({
        stem: "a/b",
        index: "41",
      });
    });
  });

  describe("given a trailing segment that is not a bare index", () => {
    it("keeps it as part of the identity", () => {
      // Collapsing on a non-numeric tail would merge genuinely different
      // groups, which is worse than a long list.
      expect(splitIndexedSuffix("a/b:trace-abc").index).toBeNull();
      expect(splitIndexedSuffix("a/b:12x").index).toBeNull();
      expect(splitIndexedSuffix("a/b:").index).toBeNull();
    });
  });

  describe("given an identifier with no separator", () => {
    it("returns it whole", () => {
      expect(splitIndexedSuffix("plain")).toEqual({
        stem: "plain",
        index: null,
      });
    });
  });
});

describe("middleEllipsis", () => {
  describe("given an identifier longer than the budget", () => {
    /** @scenario "A long identifier stays readable and copyable" */
    it("keeps both ends visible", () => {
      const out = middleEllipsis(`${TRACE}:41`, 24);

      expect(out).toHaveLength(24);
      expect(out.startsWith("project_")).toBe(true);
      expect(out.endsWith("41")).toBe(true);
      expect(out).toContain("…");
    });

    it("distinguishes identifiers sharing a long prefix", () => {
      // The whole point: right-truncation makes every ksuid in a project look
      // identical, because they share their prefix.
      const a = middleEllipsis(`${TRACE}:41`, 24);
      const b = middleEllipsis(`${TRACE}:52`, 24);

      expect(a).not.toBe(b);
    });
  });

  describe("given an identifier that already fits", () => {
    it("leaves it alone", () => {
      expect(middleEllipsis("short", 24)).toBe("short");
    });
  });
});
