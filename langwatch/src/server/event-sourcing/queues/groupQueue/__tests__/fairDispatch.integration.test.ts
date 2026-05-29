import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import {
  startTestContainers,
  stopTestContainers,
  getTestRedisConnection,
} from "../../../__tests__/integration/testContainers";
import { GroupStagingScripts } from "../scripts";

// Behavioral suite for specs/event-sourcing/work-conserving-fair-dispatch.feature.
//
// These tests drive the STABLE public API (stage -> dispatch loop -> complete)
// and assert on OUTCOMES: the per-tenant in-flight distribution read from the
// authoritative tenant_active_z truth. They are deliberately mechanism-agnostic
// so they hold under the chosen dispatch model (option C: the existing
// scan-and-gate dispatch path with a dynamic water-level cap replacing the
// static one). Fairness is produced INSIDE dispatch(); the signature does not
// change, so these tests need no edit when the dynamic cap lands.
//
// The contention scenarios are it.skip until the dynamic water-level cap is
// implemented: against today's static per-tenant cap they fail deterministically
// (equal scores tie-break by member lex, so the lexically-smaller tenant prefix
// monopolises the fleet). Un-skip each as the EVALSHA makes it pass - that is
// the red-to-green contract. The work-conserving and priority guards below pass
// today and protect against regressions.

let redis: Redis;
let scripts: GroupStagingScripts;
const QUEUE_NAME = "{test/fair-dispatch}";
const ACTIVE_TTL_SEC = 300;

function keyPrefix() {
  return `${QUEUE_NAME}:gq:`;
}

// groupId convention: "<tenantId>/<suffix>". The dispatch Lua derives the tenant
// as the substring before the first slash (mirrors prod, e.g.
// "project_FzsKx-.../fold/traceSummary/trace:...").
function gid(tenantId: string, suffix: string) {
  return `${tenantId}/${suffix}`;
}

function tenantOf(groupId: string) {
  return groupId.slice(0, groupId.indexOf("/"));
}

async function stageForTenant(
  tenantId: string,
  count: number,
  opts: { dispatchAfterMs?: number } = {},
) {
  for (let i = 0; i < count; i++) {
    const uniq = crypto.randomUUID().slice(0, 8);
    await scripts.stage({
      stagedJobId: `${tenantId}-job-${i}-${uniq}`,
      groupId: gid(tenantId, `g${i}-${uniq}`),
      dispatchAfterMs: opts.dispatchAfterMs ?? 0,
      dedupId: "",
      dedupTtlMs: 0,
      jobDataJson: JSON.stringify({ tenant: tenantId, i }),
      shouldExtend: true,
      shouldReplace: true,
    });
  }
}

// A fixed worker fleet is modelled by a tracked in-flight set: fillToFleet keeps
// dispatching until the fleet is full or ready is empty; completeSome frees
// slots (optionally for one tenant) so they can be refilled.
type Slot = { groupId: string; stagedJobId: string };
let inflight: Slot[] = [];

async function fillToFleet(size: number) {
  while (inflight.length < size) {
    const r = await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: ACTIVE_TTL_SEC });
    if (!r) break;
    inflight.push({ groupId: r.groupId, stagedJobId: r.stagedJobId });
  }
}

async function completeSome(n: number, tenant?: string) {
  const victims = inflight
    .filter((s) => !tenant || tenantOf(s.groupId) === tenant)
    .slice(0, n);
  for (const v of victims) {
    await scripts.complete({ groupId: v.groupId, stagedJobId: v.stagedJobId });
    inflight = inflight.filter((s) => s !== v);
  }
}

// In-flight count per tenant, read the same way the dispatcher reads truth:
// GC lapsed slots by score, then ZCARD.
async function inFlightByTenant(): Promise<Record<string, number>> {
  const prefix = `${keyPrefix()}tenant_active_z:`;
  const keys = await redis.keys(`${prefix}*`);
  const out: Record<string, number> = {};
  for (const k of keys) {
    await redis.zremrangebyscore(k, "-inf", Date.now());
    const n = await redis.zcard(k);
    if (n > 0) out[k.slice(prefix.length)] = n;
  }
  return out;
}

beforeAll(async () => {
  await startTestContainers();
  redis = getTestRedisConnection()!;
});

const FLEET = 20;

beforeEach(async () => {
  await redis.flushall();
  scripts = new GroupStagingScripts(redis, QUEUE_NAME);
  inflight = [];
  // Enable the dynamic water-level cap with the global budget = fleet size, so a
  // lone tenant gets W=G=20 and two contenders converge to G/2=10. readGlobalBudget
  // reads process.env per dispatch, so setting it here takes effect immediately.
  process.env.LANGWATCH_DISPATCH_GLOBAL_BUDGET = String(FLEET);
});

afterEach(() => {
  delete process.env.LANGWATCH_DISPATCH_GLOBAL_BUDGET;
});

afterAll(async () => {
  await stopTestContainers();
});

// The water level is recomputed on the 2s-gated reconcile pass; the first
// dispatch always recomputes (last-reconcile = 0). When a second tenant arrives
// mid-test we must wait past that gate so the next dispatch recomputes W with
// both tenants present. One real clock throughout (stage/complete use Date.now()).
const RECONCILE_GATE_MS = 2100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("work-conserving fair dispatch", () => {
  describe("Rule: idle capacity is always used (work-conserving)", () => {
    describe("when only one tenant has work and slots are free", () => {
      it("dispatches that tenant into every idle slot", async () => {
        await stageForTenant("tenantA", 50);

        await fillToFleet(20);

        expect(await inFlightByTenant()).toEqual({ tenantA: 20 });
      });
    });

    describe("when one tenant under-demands and another wants more (max-min)", () => {
      it("gives the small tenant all its demand and the rest to the big one", async () => {
        await stageForTenant("small", 3);
        await stageForTenant("big", 50);

        await fillToFleet(20);

        const inFlight = await inFlightByTenant();
        expect(inFlight.small).toBe(3);
        expect(inFlight.big).toBe(17);
      });
    });

    describe("when a tenant bursts then goes idle while another stays busy", () => {
      // Pins the work-conserving override against the "phantom claimant" hazard
      // of the recency-based demand signal: a tenant that bursts then drains is
      // still "fresh" in the demand window with active+parked=0, so it reads as
      // a presence-claimant and pulls a fair share even though it has no real
      // ready work. If the dynamic cap honoured that stale claim it would cap
      // the genuinely-busy tenant and idle the freed slots - reintroducing the
      // idle-behind-cap waste this whole feature removes. The contract: the cap
      // binds only under real contention; a slot that would otherwise idle is
      // filled past the fair cap rather than left empty.
      //
      // it.skip until the dynamic cap lands: this is timing-coupled - it only
      // exercises the phantom if a water-level recompute fires while the burster
      // is still inside claimantWindow. Wire the exact clock advance
      // (recomputeInterval < delta < claimantWindow, via the dispatch nowMs)
      // once those constants are fixed in the EVALSHA.
      it("does not let the idle tenant's stale claim cap the busy one", async () => {
        // burster bursts and fully drains: no active, no parked, but still fresh
        await stageForTenant("burster", 10);
        await fillToFleet(10);
        await completeSome(10, "burster");
        expect((await inFlightByTenant()).burster ?? 0).toBe(0);

        // busy is now the only tenant with real ready work
        await stageForTenant("busy", 50);
        // wait past the reconcile gate so the next dispatch recomputes W with
        // both tenants present while burster is still inside the claimant window
        // - this is when the phantom claim would bite if the override were missing
        await sleep(RECONCILE_GATE_MS);
        for (let round = 0; round < 6; round++) {
          await completeSome(5, "busy");
          await fillToFleet(20);
        }

        const inFlight = await inFlightByTenant();
        // busy uses the whole fleet; the burster's stale claim reserves nothing
        expect(inFlight.busy).toBe(20);
        expect(inFlight.burster ?? 0).toBe(0);
      });
    });
  });

  describe("Rule: fairness engages only under contention", () => {
    describe("when two equally-demanding tenants saturate the fleet", () => {
      it("splits the slots about evenly", async () => {
        await stageForTenant("tenantA", 50);
        await stageForTenant("tenantB", 50);

        await fillToFleet(20);

        const inFlight = await inFlightByTenant();
        expect(inFlight.tenantA).toBeGreaterThanOrEqual(8);
        expect(inFlight.tenantA).toBeLessThanOrEqual(12);
        expect(inFlight.tenantB).toBeGreaterThanOrEqual(8);
        expect(inFlight.tenantB).toBeLessThanOrEqual(12);
      });
    });

    describe("when a runaway tenant and a small tenant compete", () => {
      it("serves the small tenant promptly and holds the runaway to its fair share", async () => {
        await stageForTenant("runaway", 100);
        await stageForTenant("small", 2);

        await fillToFleet(20);

        const inFlight = await inFlightByTenant();
        // small gets served promptly, not starved behind the runaway backlog
        expect(inFlight.small).toBe(2);
        // runaway is held to its fair share, not the whole fleet
        expect(inFlight.runaway).toBe(18);
      });
    });
  });

  describe("Rule: a newcomer is served as capacity frees, without holding slots idle", () => {
    describe("when a newcomer arrives after an incumbent has saturated the fleet", () => {
      it("serves the newcomer up to its fair share over sustained operation, having held no slot in reserve", async () => {
        // Work-conserving when alone: the lone incumbent uses every slot. No
        // capacity was held empty in reserve for a tenant that had not arrived.
        await stageForTenant("incumbent", 100);
        await fillToFleet(20);
        expect((await inFlightByTenant()).incumbent).toBe(20);

        // Newcomer arrives into a saturated fleet.
        await stageForTenant("newcomer", 100);
        // wait past the reconcile gate so W recomputes with the newcomer present
        // (and still fresh) before the refill rounds
        await sleep(RECONCILE_GATE_MS);

        // Sustained operation: slots free by natural drain and are refilled,
        // round after round. The model-agnostic guarantee is that the newcomer
        // climbs to its fair share and the incumbent yields - whether that
        // happens per-slot or after the cap reflects the new tenant count. We do
        // NOT assert which slot goes where on any single round.
        for (let round = 0; round < 8; round++) {
          await completeSome(5);
          await fillToFleet(20);
        }

        const inFlight = await inFlightByTenant();
        // newcomer reached its fair share; incumbent was held back to make room
        expect(inFlight.newcomer ?? 0).toBeGreaterThanOrEqual(8);
        expect(inFlight.incumbent).toBeLessThanOrEqual(12);
        // and the fleet stayed full throughout - nothing left idle
        expect((inFlight.newcomer ?? 0) + (inFlight.incumbent ?? 0)).toBe(20);
      });
    });
  });

  describe("Rule: throttling is released the moment contention ends", () => {
    describe("when the competing tenant runs out of work", () => {
      it("lets the remaining tenant expand into all freed capacity", async () => {
        await stageForTenant("steady", 50);
        await stageForTenant("burst", 8);
        await fillToFleet(20);

        // burst's work is fully drained
        await completeSome(8, "burst");

        // refill: with no contention, steady reclaims the freed slots
        await fillToFleet(20);

        const inFlight = await inFlightByTenant();
        expect(inFlight.burst ?? 0).toBe(0);
        expect(inFlight.steady).toBe(20);
      });
    });
  });

  describe("Rule: a tenant's own work keeps its priority order", () => {
    describe("when one tenant has groups queued at different priorities", () => {
      it("dispatches that tenant's groups in priority order", async () => {
        // lower dispatchAfterMs == higher priority (earlier due)
        await scripts.stage({
          stagedJobId: "p-late",
          groupId: gid("solo", "late"),
          dispatchAfterMs: 2000,
          dedupId: "",
          dedupTtlMs: 0,
          jobDataJson: JSON.stringify({ p: "late" }),
          shouldExtend: true,
          shouldReplace: true,
        });
        await scripts.stage({
          stagedJobId: "p-early",
          groupId: gid("solo", "early"),
          dispatchAfterMs: 1000,
          dedupId: "",
          dedupTtlMs: 0,
          jobDataJson: JSON.stringify({ p: "early" }),
          shouldExtend: true,
          shouldReplace: true,
        });

        const first = await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: ACTIVE_TTL_SEC });
        const second = await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: ACTIVE_TTL_SEC });

        expect(first?.groupId).toBe(gid("solo", "early"));
        expect(second?.groupId).toBe(gid("solo", "late"));
      });
    });
  });

  // Off by default; fails to the protective (low) side when clamp state is gone.
  describe("Rule: an operator can still hard-clamp a pathological tenant", () => {
    it.todo("holds a tenant to an explicit ceiling regardless of free capacity");
    it.todo("leaves other tenants unaffected by one tenant's ceiling");
  });

  // Mixed-fleet rollout: an old pod (feature off, static-cap path) and a new pod
  // (feature on, dynamic-cap path) co-exist on the SAME ready zset - there is no
  // separate structure to migrate. Modelled by toggling the budget env between
  // the enqueue (old pod) and the dispatch (new pod).
  describe("Rule: upgrading the dispatch path loses no in-flight work", () => {
    it("dispatches every group queued before the upgrade", async () => {
      // old pod, feature off: groups land on the shared ready zset (and are NOT
      // added to demanding-tenants)
      delete process.env.LANGWATCH_DISPATCH_GLOBAL_BUDGET;
      await stageForTenant("pre", 12);

      // upgrade: feature on. The pre-upgrade groups are dispatched by the new
      // path with nothing stranded (an empty demanding-tenants water-fills to
      // W=G, so they are not starved by a zero-demand reading).
      process.env.LANGWATCH_DISPATCH_GLOBAL_BUDGET = String(FLEET);
      await fillToFleet(FLEET);

      expect((await inFlightByTenant()).pre).toBe(12);
    });

    it("keeps draining legacy-ready continuously-until-empty during the rollout", async () => {
      let staged = 0;
      let dispatched = 0;
      for (let wave = 0; wave < 3; wave++) {
        // old pod keeps adding to legacy-ready mid-rollout
        delete process.env.LANGWATCH_DISPATCH_GLOBAL_BUDGET;
        await stageForTenant("rollout", 5);
        staged += 5;
        // new pod drains a few each pass
        process.env.LANGWATCH_DISPATCH_GLOBAL_BUDGET = String(FLEET);
        for (let i = 0; i < 3; i++) {
          const r = await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: ACTIVE_TTL_SEC });
          if (!r) break;
          dispatched++;
          await scripts.complete({ groupId: r.groupId, stagedJobId: r.stagedJobId });
        }
      }
      // new dispatcher keeps draining until legacy-ready is empty
      for (;;) {
        const r = await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: ACTIVE_TTL_SEC });
        if (!r) break;
        dispatched++;
        await scripts.complete({ groupId: r.groupId, stagedJobId: r.stagedJobId });
      }
      // every group an old pod added mid-rollout was dispatched - none stranded
      expect(dispatched).toBe(staged);
    });
  });
});
