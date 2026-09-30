/**
 * Redeeming an activation code.
 *
 * The test that matters most is the interleaved one: two installs post the
 * same single-use code and neither write lands between the other's read and
 * its own write. Exactly one has to be told yes, and exactly one license has to
 * exist afterwards. It is deterministic, not a race: the two redemptions are
 * held at a gate until both have read the row, and only then released.
 *
 * @see ../activationCode.service.ts
 * @see specs/self-hosting/connected-services/activation-codes.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { activationCodeHash, normaliseActivationCode } from "../activationCode";
import {
  ActivationCodeService,
  type LicenseMinterPort,
} from "../activationCode.service";
import type { ActivationCodeRecord } from "../activationCodes";
import { CODE, codeRecord, InMemoryActivationCodes } from "./activationFakes";

const NOW = new Date("2026-09-21T12:00:00.000Z");

function hashOf(_row: ActivationCodeRecord): string {
  const normalised = normaliseActivationCode(CODE);
  if (!normalised) throw new Error("the fixture code is not a code");
  return activationCodeHash(normalised);
}

function minterSpy(): LicenseMinterPort & { minted: number } {
  let minted = 0;
  const port = {
    get minted() {
      return minted;
    },
    issue: vi.fn(async () => {
      minted += 1;
      return {
        licenseKey: `signed-license-${minted}`,
        license: { id: `license-${minted}` },
      };
    }),
  };
  return port as unknown as LicenseMinterPort & { minted: number };
}

function serviceOver({
  rows = [codeRecord()],
  licenses = minterSpy(),
  allow = true,
}: {
  rows?: ActivationCodeRecord[];
  licenses?: LicenseMinterPort;
  allow?: boolean;
} = {}) {
  const repository = new InMemoryActivationCodes(rows, hashOf);
  const service = new ActivationCodeService({
    repository,
    licenses,
    rateLimit: { allow: vi.fn(async () => allow) },
    systemActorId: "system-connect-license",
    now: () => NOW,
  });
  return { service, repository, licenses };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given a single-use code for a customer on the enterprise plan", () => {
  describe("when an install redeems it", () => {
    /** @scenario "A valid code mints the license it describes" */
    it("signs a license for that customer and records which install took it", async () => {
      const { service, repository, licenses } = serviceOver();

      const result = await service.redeem({
        code: CODE,
        instanceId: "instance-a",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.licenseKey).toBe("signed-license-1");
      expect(result.maxMembers).toBe(25);
      // The term runs from the day the code was redeemed, not from the day it
      // was issued: a customer who waits three weeks does not lose them.
      expect(result.expiresAt.getTime()).toBe(
        NOW.getTime() + 365 * 24 * 60 * 60 * 1000,
      );
      expect(licenses.issue).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: { organizationId: "org-acme" },
          terms: { services: ["instant_evals"] },
        }),
      );

      const row = await repository.findById("code-1");
      expect(row?.redeemedByInstanceId).toBe("instance-a");
      expect(row?.issuedLicenseId).toBe("license-1");
    });

    /** @scenario "A code must be presented with an instance id" */
    it("refuses with no instance id, and mints nothing", async () => {
      const { service, licenses } = serviceOver();

      const result = await service.redeem({ code: CODE, instanceId: "" });

      expect(result).toEqual({ ok: false, code: "connect_instance_required" });
      expect(licenses.issue).not.toHaveBeenCalled();
    });
  });
});

describe("given a revoked code", () => {
  describe("when an install redeems it", () => {
    /** @scenario "A revoked code reads exactly like one that was never issued" */
    it("says it is not one we issued, and names no customer", async () => {
      const { service } = serviceOver({
        rows: [codeRecord({ revokedAt: new Date("2026-09-20T00:00:00.000Z") })],
      });

      const result = await service.redeem({
        code: CODE,
        instanceId: "instance-a",
      });

      expect(result).toEqual({
        ok: false,
        code: "activation_code_not_found",
      });
      expect(JSON.stringify(result)).not.toContain("ACME");
    });
  });
});

describe("given a code past its expiry", () => {
  describe("when an install redeems it", () => {
    /** @scenario "An expired code is refused" */
    it("refuses it as expired and mints nothing", async () => {
      const { service, licenses } = serviceOver({
        rows: [codeRecord({ expiresAt: new Date("2026-09-01T00:00:00.000Z") })],
      });

      const result = await service.redeem({
        code: CODE,
        instanceId: "instance-a",
      });

      expect(result).toEqual({ ok: false, code: "activation_code_expired" });
      expect(licenses.issue).not.toHaveBeenCalled();
    });
  });
});

describe("given a code attempted more times than the limit allows", () => {
  describe("when another attempt arrives", () => {
    /** @scenario "Too many attempts on one code are refused" */
    it("refuses before the registry is read", async () => {
      const { service, licenses } = serviceOver({ allow: false });

      const result = await service.redeem({
        code: CODE,
        instanceId: "instance-a",
      });

      expect(result).toEqual({ ok: false, code: "rate_limited" });
      expect(licenses.issue).not.toHaveBeenCalled();
    });
  });
});

describe("given two installs posting the same single-use code", () => {
  describe("when both are redeemed with no write landing between them", () => {
    /** @scenario "A single-use code is redeemed by exactly one of two simultaneous installs" */
    it("tells exactly one of them yes and mints exactly one license", async () => {
      const { service, repository, licenses } = serviceOver();

      // Both redemptions are held after they have read the row and before
      // either claims it, which is exactly the window a check-then-write loses
      // in. Releasing them together is the interleaving under test.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let waiting = 0;
      const originalFind = repository.findByCodeHash.bind(repository);
      repository.findByCodeHash = async (codeHash: string) => {
        const row = await originalFind(codeHash);
        waiting += 1;
        if (waiting === 2) release();
        await gate;
        return row;
      };

      const [first, second] = await Promise.all([
        service.redeem({ code: CODE, instanceId: "instance-a" }),
        service.redeem({ code: CODE, instanceId: "instance-b" }),
      ]);

      const answers = [first, second];
      expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
      const refused = answers.find((answer) => !answer.ok);
      expect(refused).toEqual({
        ok: false,
        code: "activation_code_already_redeemed",
      });

      expect(licenses.issue).toHaveBeenCalledTimes(1);
      expect(repository.claimsWon).toBe(1);
      const row = await repository.findById("code-1");
      expect(row?.redemptionCount).toBe(1);
    });
  });
});

describe("given a code whose license could not be signed", () => {
  describe("when an install redeems it", () => {
    /** @scenario "A claim whose license could not be signed is released again" */
    it("lets the failure travel and leaves the code redeemable", async () => {
      const failing: LicenseMinterPort = {
        issue: vi.fn(async () => {
          throw new Error("the license signing key is not configured");
        }),
      };
      const { service, repository } = serviceOver({ licenses: failing });

      await expect(
        service.redeem({ code: CODE, instanceId: "instance-a" }),
      ).rejects.toThrow("the license signing key is not configured");

      const row = await repository.findById("code-1");
      expect(row?.redeemedAt).toBeNull();
      expect(row?.redemptionCount).toBe(0);

      const working = minterSpy();
      const retried = new ActivationCodeService({
        repository,
        licenses: working,
        rateLimit: { allow: async () => true },
        systemActorId: "system-connect-license",
        now: () => NOW,
      });
      const result = await retried.redeem({
        code: CODE,
        instanceId: "instance-a",
      });
      expect(result.ok).toBe(true);
    });
  });
});

describe("given a reusable code", () => {
  describe("when three installs redeem it", () => {
    /** @scenario "A reusable code is redeemed by every install that presents it" */
    it("gives all three a license and counts three redemptions", async () => {
      const { service, repository, licenses } = serviceOver({
        rows: [codeRecord({ reusable: true })],
      });

      for (const instanceId of ["a", "b", "c"]) {
        const result = await service.redeem({ code: CODE, instanceId });
        expect(result.ok).toBe(true);
      }

      expect(licenses.issue).toHaveBeenCalledTimes(3);
      const row = await repository.findById("code-1");
      expect(row?.redemptionCount).toBe(3);
      // A reusable code names no single license, because it mints many.
      expect(row?.issuedLicenseId).toBeNull();
    });
  });
});

describe("given a code that was already redeemed", () => {
  describe("when the same install presents it again", () => {
    it("refuses it, because a single-use code mints one license and only one", async () => {
      const { service } = serviceOver({
        rows: [
          codeRecord({
            redeemedAt: new Date("2026-09-20T00:00:00.000Z"),
            redeemedByInstanceId: "instance-a",
            redemptionCount: 1,
          }),
        ],
      });

      const result = await service.redeem({
        code: CODE,
        instanceId: "instance-a",
      });

      expect(result).toEqual({
        ok: false,
        code: "activation_code_already_redeemed",
      });
    });
  });
});
