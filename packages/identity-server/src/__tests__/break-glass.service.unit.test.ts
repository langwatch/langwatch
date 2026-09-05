import { beforeEach, describe, expect, it } from "vitest";
import { SsoBreakGlassService } from "../break-glass.service";
import {
  CollectingBreakGlassNotifier,
  InMemoryBreakGlassBindings,
} from "./support/in-memory-break-glass";

/**
 * When a way back in ends, and what is said before it does (D05).
 *
 * The expiry itself is the interesting part: nothing runs it. A binding
 * stops being a way in because two numbers are compared at the moment
 * somebody asks, so the sweep here can only ever be late with a WARNING —
 * never with an access decision.
 */

const ORG = "org_acme";
const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = 1_756_000_000_000;

let bindings: InMemoryBreakGlassBindings;
let notifier: CollectingBreakGlassNotifier;
let clock: number;
let minted: number;
let service: SsoBreakGlassService;
/** What the revoke guard's one outside fact answers, per test. */
let connectionActive = false;
/** Who is NOT an administrator of the organization, per test. Empty by
 *  default: a grant names somebody eligible unless a case says otherwise. */
let ineligible = new Set<string>();

beforeEach(() => {
  bindings = new InMemoryBreakGlassBindings();
  notifier = new CollectingBreakGlassNotifier();
  clock = T0;
  minted = 0;
  connectionActive = false;
  ineligible = new Set<string>();
  service = new SsoBreakGlassService({
    bindings,
    notifier,
    newBindingId: () => `ssobg_${++minted}`,
    organizationHasActiveConnection: async () => connectionActive,
    holderIsEligible: async ({ userId }) => !ineligible.has(userId),
    now: () => clock,
  });
});

describe("granting a way in to somebody who could not use it", () => {
  describe("when the holder is not an administrator of the organization", () => {
    it("refuses the grant rather than writing a door that opens for nobody", async () => {
      // Activation refuses without a live binding, on the strength of
      // "somebody can still get in if the identity provider fails". A binding
      // naming a typo, or an id from another organization, satisfies that
      // check and opens nothing — the precondition passes and the thing it
      // promised does not exist.
      ineligible.add("user_stranger");

      const refusal = await service
        .grant({
          organizationId: "org_acme",
          userId: "user_stranger",
          grantedByUserId: "user_ana",
          expiresAtMs: T0 + 14 * DAY_MS,
        })
        .then(
          () => {
            throw new Error("the grant was expected to be refused");
          },
          (error: { code: string }) => error,
        );

      expect(refusal.code).toBe("sso_break_glass_holder_ineligible");
      expect(bindings.rows.size).toBe(0);
    });
  });

  describe("when the holder stopped being an administrator before a renewal", () => {
    it("refuses to extend a door that no longer opens", async () => {
      const granted = await service.grant({
        organizationId: "org_acme",
        userId: "user_ana",
        grantedByUserId: "user_ana",
        expiresAtMs: T0 + 14 * DAY_MS,
      });
      ineligible.add("user_ana");

      const refusal = await service
        .renew({
          bindingId: granted.bindingId,
          organizationId: "org_acme",
          grantedByUserId: "user_ana",
          expiresAtMs: T0 + 28 * DAY_MS,
        })
        .then(
          () => {
            throw new Error("the renewal was expected to be refused");
          },
          (error: { code: string }) => error,
        );

      expect(refusal.code).toBe("sso_break_glass_holder_ineligible");
    });
  });
});

describe("a way back in that ends in fourteen days", () => {
  describe("when each of fourteen, seven and one day remain", () => {
    /** @scenario "A way back in ends on its own date, and says so before it does" */
    it("warns each time naming the person and the date, then stops working with nobody acting", async () => {
      const granted = await service.grant({
        organizationId: ORG,
        userId: "user_sam",
        grantedByUserId: "user_ana",
        expiresAtMs: T0 + 14 * DAY_MS,
      });

      // Each mark, once, as the days pass. Sweeping twice on the same day
      // says nothing the second time.
      for (const daysOut of [14, 7, 1]) {
        clock = granted.expiresAtMs - daysOut * DAY_MS;
        await service.sweepWarnings();
        await service.sweepWarnings();
      }

      expect(notifier.warnings).toEqual([
        {
          userId: "user_sam",
          expiresAtMs: granted.expiresAtMs,
          daysRemaining: 14,
        },
        {
          userId: "user_sam",
          expiresAtMs: granted.expiresAtMs,
          daysRemaining: 7,
        },
        {
          userId: "user_sam",
          expiresAtMs: granted.expiresAtMs,
          daysRemaining: 1,
        },
      ]);

      // On the date it ends it stops working, and nobody had to act for that
      // to happen: no sweep ran between the last warning and here.
      clock = granted.expiresAtMs;
      expect(await service.hasLiveBinding({ organizationId: ORG })).toBe(false);
      expect(notifier.warnings).toHaveLength(3);
    });

    it("still says the marks it slept through, once each", async () => {
      const granted = await service.grant({
        organizationId: ORG,
        userId: "user_sam",
        grantedByUserId: "user_ana",
        expiresAtMs: T0 + 14 * DAY_MS,
      });

      // A worker down from the grant until two days out. The question is
      // which marks the binding has PASSED, not which one is exactly today,
      // so the person is told rather than silently skipped — and the number
      // they read is the days actually left, never the mark that tripped.
      clock = granted.expiresAtMs - 2 * DAY_MS;
      await service.sweepWarnings();

      expect(notifier.warnings).toEqual([
        {
          userId: "user_sam",
          expiresAtMs: granted.expiresAtMs,
          daysRemaining: 2,
        },
      ]);
      expect(bindings.rows.get(granted.bindingId)?.warnedDays).toEqual([14, 7]);
    });
  });
});

describe("ending a way back in on purpose", () => {
  /** @scenario "A way back in can be ended on purpose" */
  it("stops it immediately and keeps the grant readable afterwards", async () => {
    const granted = await service.grant({
      organizationId: ORG,
      userId: "user_sam",
      grantedByUserId: "user_ana",
      expiresAtMs: T0 + 14 * DAY_MS,
    });

    const ended = await service.revoke({
      bindingId: granted.bindingId,
      organizationId: ORG,
    });

    expect(ended.supersededAtMs).toBe(clock);
    expect(await service.hasLiveBinding({ organizationId: ORG })).toBe(false);
    // The history keeps the whole grant: who, until when, and that it ended.
    const history = await service.history({ organizationId: ORG });
    expect(history.map((binding) => binding.bindingId)).toContain(
      granted.bindingId,
    );
  });

  it("answers an already-ended grant as if it just had, changing nothing", async () => {
    const granted = await service.grant({
      organizationId: ORG,
      userId: "user_sam",
      grantedByUserId: "user_ana",
      expiresAtMs: T0 + 14 * DAY_MS,
    });
    clock = granted.expiresAtMs + DAY_MS;

    const ended = await service.revoke({
      bindingId: granted.bindingId,
      organizationId: ORG,
    });

    // Expired already; nothing was written on the row over it.
    expect(ended.supersededAtMs).toBeNull();
  });

  /** @scenario "The last way back in cannot be ended while the connection decides sign-in" */
  it("refuses to end the only live way in while a connection is ACTIVE", async () => {
    connectionActive = true;
    const granted = await service.grant({
      organizationId: ORG,
      userId: "user_sam",
      grantedByUserId: "user_ana",
      expiresAtMs: T0 + 14 * DAY_MS,
    });

    await expect(
      service.revoke({ bindingId: granted.bindingId, organizationId: ORG }),
    ).rejects.toMatchObject({ code: "sso_break_glass_last_way_in" });
    expect(await service.hasLiveBinding({ organizationId: ORG })).toBe(true);

    // A second live grant is exactly what unblocks it.
    await service.grant({
      organizationId: ORG,
      userId: "user_ana",
      grantedByUserId: "user_ana",
      expiresAtMs: T0 + 14 * DAY_MS,
    });
    const ended = await service.revoke({
      bindingId: granted.bindingId,
      organizationId: ORG,
    });
    expect(ended.supersededAtMs).toBe(clock);
  });
});
