import {
  ActivationCodeAlreadyRedeemedError,
  ActivationCodeExpiredError,
  ActivationCodeMalformedError,
  ActivationCodeNotFoundError,
  ActivationRateLimitedError,
  ConnectInstanceRequiredError,
} from "@langwatch/enterprise-licensing-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { ActivationCodeRecord } from "../../repositories/activation-code.repository.ts";
import { MemoryActivationCodeRepository } from "../../repositories/memory/memory.activation-code.repository.ts";
import {
  activationCodeHash,
  activationCodeHint,
  mintActivationCode,
  normaliseActivationCode,
} from "../../rules/activation-code.rules.ts";
import {
  ActivationCodeService,
  type ActivationCredentials,
  type LicenseMinter,
} from "../activation-code.service.ts";

const NOW: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");
const CODE = "LW-A1B2-C3D4-E5F6-G7H8";
const NORMALISED = "LWA1B2C3D4E5F6G7H8";

function rowFor(
  overrides: Partial<ActivationCodeRecord> = {},
): ActivationCodeRecord & { codeHash: string } {
  return {
    id: "code-1",
    codeHash: activationCodeHash(NORMALISED),
    codeHint: activationCodeHint(NORMALISED),
    organizationId: "org-acme",
    organizationName: "ACME",
    email: "ops@example.com",
    planType: "ENTERPRISE",
    maxMembers: 25,
    maxMembersLite: 0,
    licenseTermDays: 365,
    services: ["instant_evals"],
    expiresAt: Temporal.Instant.from("2026-02-01T00:00:00.000Z"),
    reusable: false,
    redeemedAt: null,
    redeemedByInstanceId: null,
    issuedLicenseId: null,
    redemptionCount: 0,
    revokedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

class RecordingMinter implements LicenseMinter {
  readonly issued: { organizationId: string; expiresAt: string; services?: string[] }[] = [];
  refusing = false;

  async issue(input: Parameters<LicenseMinter["issue"]>[0]) {
    if (this.refusing) throw new Error("the signing key is not configured");
    this.issued.push({
      organizationId: input.customer.organizationId,
      expiresAt: input.expiresAt.toString(),
      ...(input.terms?.services ? { services: [...input.terms.services] } : {}),
    });
    return { licenseKey: "LW-SIGNED-LICENSE", license: { id: "issued-license-1" } };
  }
}

/** The credential path an activation hands a fresh license to, recorded. */
class RecordingCredentials implements ActivationCredentials {
  readonly resolved: { token: string; instanceId: string }[] = [];

  async resolve(input: { token: string; instanceId: string }): Promise<{ ok: boolean }> {
    this.resolved.push(input);
    return { ok: true };
  }

  tokenOf(licenseKey: string): string {
    return `token-of(${licenseKey})`;
  }
}

function harness(
  options: { rows?: (ActivationCodeRecord & { codeHash: string })[]; allow?: boolean } = {},
) {
  const repository = MemoryActivationCodeRepository.create(options.rows ?? [rowFor()]);
  const licenses = new RecordingMinter();
  const credentials = new RecordingCredentials();
  const service = ActivationCodeService.create({
    repository,
    licenses,
    credentials,
    rateLimit: { allow: async () => options.allow ?? true },
    systemActorId: "system",
    now: () => NOW,
  });
  return { repository, licenses, credentials, service };
}

describe("the shape of an activation code", () => {
  /** @scenario "A code is read back however it was typed" */
  it("reads the same code whether it was pasted, dictated or shouted", () => {
    expect(normaliseActivationCode("lw-a1b2 c3d4-e5f6 g7h8")).toBe(NORMALISED);
    expect(normaliseActivationCode(CODE)).toBe(NORMALISED);
    expect(normaliseActivationCode("  LWA1B2C3D4E5F6G7H8  ")).toBe(NORMALISED);
  });

  /** @scenario "The stored hash is not itself a usable code" */
  it("stores a value that is not itself a code", () => {
    const hash = activationCodeHash(NORMALISED);

    expect(hash).not.toBe(NORMALISED);
    expect(normaliseActivationCode(hash)).toBeNull();
  });

  /** @scenario "A minted code uses no character a person would misread" */
  it("mints from an alphabet holding no I, L, O or U", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = mintActivationCode();
      expect(normaliseActivationCode(code)?.slice(2)).not.toMatch(/[ILOU]/);
    }
  });

  it("refuses text that is not a code", () => {
    expect(normaliseActivationCode("LW-SHORT")).toBeNull();
    expect(normaliseActivationCode("XX-A1B2-C3D4-E5F6-G7H8")).toBeNull();
  });
});

describe("redeeming an activation code", () => {
  it("binds the minted license to the install that redeemed it, so its first hosted call resolves", async () => {
    const { service, credentials } = harness();

    await service.redeem({ code: CODE, instanceId: "install-1" });

    expect(credentials.resolved).toEqual([
      { token: "token-of(LW-SIGNED-LICENSE)", instanceId: "install-1" },
    ]);
  });

  /** @scenario "A valid code mints the license it describes" */
  it("mints the license the code describes and names the code's services", async () => {
    const { service, licenses } = harness();

    const redemption = await service.redeem({ code: CODE, instanceId: "install-1" });

    expect(redemption).toEqual({
      licenseKey: "LW-SIGNED-LICENSE",
      planType: "ENTERPRISE",
      maxMembers: 25,
      expiresAt: "2027-01-01T00:00:00Z",
      services: ["instant_evals"],
    });
    expect(licenses.issued).toEqual([
      {
        organizationId: "org-acme",
        expiresAt: "2027-01-01T00:00:00Z",
        services: ["instant_evals"],
      },
    ]);
  });

  it("refuses text that is not a code, before any lookup", async () => {
    const { service } = harness();

    await expect(service.redeem({ code: "nope", instanceId: "install-1" })).rejects.toBeInstanceOf(
      ActivationCodeMalformedError,
    );
  });

  /** @scenario "A code must be presented with an instance id" */
  it("refuses a code presented without an instance id", async () => {
    const { service } = harness();

    await expect(service.redeem({ code: CODE, instanceId: "  " })).rejects.toBeInstanceOf(
      ConnectInstanceRequiredError,
    );
  });

  /** @scenario "A revoked code reads exactly like one that was never issued" */
  it("answers a revoked code and an unknown one the same way", async () => {
    const revoked = harness({ rows: [rowFor({ revokedAt: NOW })] });
    const unknown = harness({ rows: [] });

    await expect(
      revoked.service.redeem({ code: CODE, instanceId: "install-1" }),
    ).rejects.toBeInstanceOf(ActivationCodeNotFoundError);
    await expect(
      unknown.service.redeem({ code: CODE, instanceId: "install-1" }),
    ).rejects.toBeInstanceOf(ActivationCodeNotFoundError);
  });

  /** @scenario "An expired code is refused" */
  it("refuses a code whose own term has ended", async () => {
    const { service } = harness({
      rows: [rowFor({ expiresAt: Temporal.Instant.from("2025-12-01T00:00:00.000Z") })],
    });

    await expect(service.redeem({ code: CODE, instanceId: "install-1" })).rejects.toBeInstanceOf(
      ActivationCodeExpiredError,
    );
  });

  /** @scenario "Too many attempts on one code are refused" */
  it("refuses once the limiter says this code has been tried enough", async () => {
    const { service } = harness({ allow: false });

    await expect(service.redeem({ code: CODE, instanceId: "install-1" })).rejects.toBeInstanceOf(
      ActivationRateLimitedError,
    );
  });

  /** @scenario "A single-use code is redeemed by exactly one of two simultaneous installs" */
  it("lets exactly one of two installs win a single-use code", async () => {
    const { service, licenses } = harness();

    const outcomes = await Promise.allSettled([
      service.redeem({ code: CODE, instanceId: "install-1" }),
      service.redeem({ code: CODE, instanceId: "install-2" }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const refused = outcomes.find((outcome) => outcome.status === "rejected");
    expect(refused?.status === "rejected" && refused.reason).toBeInstanceOf(
      ActivationCodeAlreadyRedeemedError,
    );
    expect(licenses.issued).toHaveLength(1);
  });

  /** @scenario "A claim whose license could not be signed is released again" */
  it("puts the claim back when signing failed, so the code is not burned", async () => {
    const { service, licenses, repository } = harness();
    licenses.refusing = true;

    await expect(service.redeem({ code: CODE, instanceId: "install-1" })).rejects.toThrow(
      "the signing key is not configured",
    );
    expect(await repository.findById("code-1")).toMatchObject({
      redeemedAt: null,
      redeemedByInstanceId: null,
      redemptionCount: 0,
    });

    licenses.refusing = false;
    await expect(service.redeem({ code: CODE, instanceId: "install-1" })).resolves.toMatchObject({
      licenseKey: "LW-SIGNED-LICENSE",
    });
  });

  /** @scenario "A reusable code is redeemed by every install that presents it" */
  it("lets every install redeem a reusable code, counting each redemption", async () => {
    const { service, repository, licenses } = harness({ rows: [rowFor({ reusable: true })] });

    await service.redeem({ code: CODE, instanceId: "install-1" });
    await service.redeem({ code: CODE, instanceId: "install-2" });

    expect(licenses.issued).toHaveLength(2);
    expect(await repository.findById("code-1")).toMatchObject({
      redemptionCount: 2,
      issuedLicenseId: null,
    });
  });

  it("names the license a single-use redemption minted", async () => {
    const { service, repository } = harness();

    await service.redeem({ code: CODE, instanceId: "install-1" });

    expect(await repository.findById("code-1")).toMatchObject({
      issuedLicenseId: "issued-license-1",
      redeemedByInstanceId: "install-1",
    });
  });
});

describe("the backoffice side of activation codes", () => {
  it("returns the code once and stores only its hash and hint", async () => {
    const { service, repository } = harness({ rows: [] });

    const issued = await service.issue({
      organizationId: "org-acme",
      organizationName: "ACME",
      email: "ops@example.com",
      planType: "ENTERPRISE",
      maxMembers: 25,
      licenseTermDays: 365,
      expiresAt: "2026-02-01T00:00:00Z",
      operatorId: "operator-1",
    });

    expect(normaliseActivationCode(issued.code)).not.toBeNull();
    expect(issued.row.codeHint).toHaveLength(4);
    expect(issued.row).not.toHaveProperty("codeHash");
    expect(await repository.findByCodeHash(activationCodeHash(issued.code))).toBeNull();
  });

  it("lists codes with the verdict already worked out", async () => {
    const { service } = harness({
      rows: [rowFor(), rowFor({ id: "code-2", revokedAt: NOW })],
    });

    const page = await service.list({ page: 0, pageSize: 10 });

    expect(page.total).toBe(2);
    expect(page.codes.map((code) => code.status)).toEqual(["active", "revoked"]);
  });

  it("refuses to revoke a code twice, by name", async () => {
    const { service } = harness();

    await expect(service.revoke({ id: "code-1", operatorId: "operator-1" })).resolves.toMatchObject(
      { status: "revoked" },
    );
    await expect(service.revoke({ id: "code-1", operatorId: "operator-1" })).rejects.toBeInstanceOf(
      ActivationCodeNotFoundError,
    );
  });
});
