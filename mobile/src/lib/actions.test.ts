import { describe, expect, it } from "vitest";

import {
  actionSpec,
  anomalyActions,
  blobActions,
  deadLetterActions,
  groupActions,
  isActionConfirmed,
  jobActions,
  pausedTenantActions,
  queueActions,
  type ActionId,
} from "./actions";

const ids = (specs: { id: ActionId }[]) => specs.map((spec) => spec.id);

describe("groupActions", () => {
  describe("given a blocked group with queued jobs", () => {
    it("offers to unblock, move to dead letters, or drain", () => {
      expect(ids(groupActions({ isBlocked: true, pendingJobs: 4 }))).toEqual([
        "unblock-group",
        "move-group-to-dlq",
        "drain-group",
      ]);
    });
  });

  describe("given a group that is not blocked", () => {
    it("does not offer to unblock it", () => {
      // A control that can only mislead is worse than no control.
      expect(ids(groupActions({ isBlocked: false, pendingJobs: 4 }))).toEqual([
        "drain-group",
      ]);
    });
  });

  describe("given a group with nothing queued", () => {
    it("does not offer to drain it", () => {
      expect(
        ids(groupActions({ isBlocked: false, pendingJobs: 0 })),
      ).toEqual([]);
    });
  });
});

describe("queueActions", () => {
  describe("given a queue with blocked groups", () => {
    it("offers the canaries before the sweeping actions", () => {
      const offered = ids(queueActions({ blockedGroupCount: 12, dlqCount: 0 }));

      expect(offered).toEqual([
        "canary-unblock",
        "canary-redrive",
        "unblock-all",
        "move-all-blocked-to-dlq",
      ]);
    });

    it("offers no way to drain a whole queue", () => {
      // The server has no such mutation — clearing a queue means moving it to
      // dead letters, where the work still exists. An action that could only
      // fail is worse than no action.
      const offered = ids(queueActions({ blockedGroupCount: 12, dlqCount: 9 }));

      expect(offered).not.toContain("drain-all-blocked");
      expect(offered.every((id) => !id.startsWith("drain-"))).toBe(true);
    });
  });

  describe("given a queue with dead letters", () => {
    it("offers to replay them", () => {
      expect(ids(queueActions({ blockedGroupCount: 0, dlqCount: 3 }))).toEqual([
        "replay-all-dlq",
      ]);
    });
  });

  describe("given a healthy queue", () => {
    it("offers nothing", () => {
      expect(ids(queueActions({ blockedGroupCount: 0, dlqCount: 0 }))).toEqual(
        [],
      );
    });
  });
});

describe("blobActions", () => {
  describe("given a payload nothing holds", () => {
    it("offers to delete it", () => {
      expect(ids(blobActions({ liveLeases: 0 }))).toEqual(["delete-blob"]);
    });
  });

  describe("given a payload with a live lease", () => {
    it("offers nothing, because the server would refuse anyway", () => {
      expect(ids(blobActions({ liveLeases: 2 }))).toEqual([]);
    });
  });
});

describe("jobActions", () => {
  it("offers a retry only inside a blocked group", () => {
    expect(ids(jobActions({ isBlocked: true }))).toEqual(["retry-job"]);
    expect(ids(jobActions({ isBlocked: false }))).toEqual([]);
  });
});

describe("the shape of each guardrail", () => {
  describe("given an action that destroys work", () => {
    it("requires a typed confirmation", () => {
      for (const id of ["drain-group", "drain-tenant", "delete-blob"] as const) {
        const spec = actionSpec(id);
        expect(spec.destructive).toBe(true);
        expect(spec.confirmWord).toBeTruthy();
      }
    });
  });

  describe("given an action that only moves work", () => {
    it("does not ask for a typed confirmation", () => {
      // Asking everywhere would train operators to type it without reading.
      for (const id of [
        "unblock-group",
        "move-group-to-dlq",
        "replay-dlq-group",
        "replay-all-dlq",
        "unpause-tenant",
        "dismiss-anomaly",
      ] as const) {
        const spec = actionSpec(id);
        expect(spec.destructive).toBe(false);
        expect(spec.confirmWord).toBeUndefined();
      }
    });
  });

  describe("given an action whose blast radius is not visible from the row", () => {
    it("previews first", () => {
      expect(actionSpec("move-all-blocked-to-dlq").needsPreview).toBe(true);
    });
  });

  describe("given an action on a single named thing", () => {
    it("needs no preview", () => {
      expect(actionSpec("unblock-group").needsPreview).toBeUndefined();
      expect(actionSpec("replay-dlq-group").needsPreview).toBeUndefined();
    });
  });

  it("says what each action costs, not merely what it is called", () => {
    for (const spec of [
      ...groupActions({ isBlocked: true, pendingJobs: 1 }),
      ...queueActions({ blockedGroupCount: 1, dlqCount: 1 }),
      ...pausedTenantActions(),
      ...deadLetterActions(),
      ...anomalyActions(),
      ...blobActions({ liveLeases: 0 }),
    ]) {
      expect(spec.description.length).toBeGreaterThan(30);
    }
  });

  it("warns that destroyed work cannot be recovered", () => {
    for (const id of ["drain-group", "drain-tenant"] as const) {
      expect(actionSpec(id).description).toContain("cannot be recovered");
    }
  });
});

describe("isActionConfirmed", () => {
  describe("given an action with no confirmation word", () => {
    it("is always confirmed", () => {
      expect(isActionConfirmed(actionSpec("unblock-group"), "")).toBe(true);
    });
  });

  describe("given an action that requires typing", () => {
    const spec = actionSpec("drain-group");

    it("accepts the exact word", () => {
      expect(isActionConfirmed(spec, spec.confirmWord!)).toBe(true);
    });

    it("refuses anything else", () => {
      expect(isActionConfirmed(spec, "")).toBe(false);
      expect(isActionConfirmed(spec, "discard")).toBe(false);
      expect(isActionConfirmed(spec, " DISCARD ")).toBe(false);
      expect(isActionConfirmed(spec, "DISCAR")).toBe(false);
    });
  });

  describe("given two different destructive actions", () => {
    it("does not accept one's word for the other", () => {
      // Muscle memory from the last confirmation must not carry over.
      const drain = actionSpec("drain-group");
      const del = actionSpec("delete-blob");

      expect(isActionConfirmed(del, drain.confirmWord!)).toBe(false);
    });
  });
});
