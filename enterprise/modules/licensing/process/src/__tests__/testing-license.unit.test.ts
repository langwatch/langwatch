/**
 * Developer testing licences (ADR-180 sections 3 and 4): what the signed licence says, and how
 * upload, plan reads and the platform single sign-on gate honour it.
 * Spec: specs/self-hosting/connected-services/testing-licenses.feature
 */
import {
  LicenseGenerationService,
  NodeLicenseCryptographyService,
} from "@langwatch/enterprise-license-signing";
import {
  LICENSE_ERRORS,
  UNLIMITED_PLAN,
  licenseDataSchema,
  licenseValidationError,
} from "@langwatch/enterprise-licensing-contract";
import { Temporal, toDate, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { LicenseService, LicenseServiceConfiguration } from "../services/license.service.ts";
import {
  BASE_LICENSE,
  EXPIRED_ENTERPRISE_LICENSE_KEY,
  MemoryLicenseStorage,
  TEST_PRIVATE_KEY,
  TEST_PUBLIC_KEY,
  VALID_LICENSE_KEY,
} from "./testing.ts";

const cryptography = NodeLicenseCryptographyService.create({ publicKey: TEST_PUBLIC_KEY });
const generation = LicenseGenerationService.create(cryptography);

// Ahead of the wall clock, so the term is read on the injected clock alone.
const ISSUED: Instant = Temporal.Instant.from("2030-01-01T00:00:00Z");
const EXPIRES: Instant = Temporal.Instant.from("2030-01-06T00:00:00Z");

function testingLicense({
  instanceId = "instance-a",
  organizationId = "org-local",
}: { instanceId?: string; organizationId?: string } = {}) {
  return generation.generate({
    organizationId,
    organizationName: "Developer stack",
    email: "developer@langwatch.test",
    planType: "ENTERPRISE",
    maxMembers: 10,
    maxMembersLite: 10,
    expiresAt: toDate(EXPIRES),
    privateKey: TEST_PRIVATE_KEY,
    now: toDate(ISSUED),
    testing: { instanceId },
  });
}

function encode(data: Parameters<NodeLicenseCryptographyService["signLicense"]>[0]): string {
  return cryptography.encodeLicenseKey(cryptography.signLicense(data, TEST_PRIVATE_KEY));
}

function install({
  instanceId = "instance-a",
  instanceIdOverridden = false,
  at = Temporal.Instant.from("2030-01-02T00:00:00Z"),
}: {
  instanceId?: string | (() => Promise<string>);
  instanceIdOverridden?: boolean;
  at?: Instant;
} = {}) {
  const clock = { now: at };
  const asked = { instanceId: 0 };
  const storage = MemoryLicenseStorage.create({ organizations: ["org-local", "org-other"] });
  const service = LicenseService.create({
    repository: storage,
    cryptography,
    configuration: LicenseServiceConfiguration.create({ now: () => clock.now }),
    instanceIdOverridden,
    instanceId:
      typeof instanceId === "function"
        ? instanceId
        : async () => {
            asked.instanceId += 1;
            return instanceId;
          },
  });
  const advance = (duration: Parameters<Instant["add"]>[0]) => {
    clock.now = clock.now.add(duration);
  };
  return { service, storage, advance, asked };
}

describe("given a testing licence signed on Cloud", () => {
  /** @scenario "A testing license carries its kind and its instance" */
  it("says it is a testing licence and names its instance and local organization", () => {
    const { licenseKey } = testingLicense();

    const signed = cryptography.parseLicenseKey(licenseKey);

    expect(signed?.data).toMatchObject({
      kind: "testing",
      instanceId: "instance-a",
      organizationId: "org-local",
    });
    expect(signed !== null && cryptography.verifySignature(signed)).toBe(true);
  });

  /** @scenario "A testing license carries its kind and its instance" */
  it("refuses one that names no instance or no organization, and an instance on a standard licence", () => {
    const noInstance = encode({ ...BASE_LICENSE, organizationId: "org-local", kind: "testing" });
    const noOrganization = encode({ ...BASE_LICENSE, kind: "testing", instanceId: "instance-a" });
    const standardWithInstance = encode({ ...BASE_LICENSE, instanceId: "instance-a" });

    expect(cryptography.parseLicenseKey(noInstance)).toBeNull();
    expect(cryptography.parseLicenseKey(noOrganization)).toBeNull();
    expect(cryptography.parseLicenseKey(standardWithInstance)).toBeNull();
  });

  /** @scenario "A testing license carries its kind and its instance" */
  it("fails the signature check of a release that does not know the claims", () => {
    const signed = cryptography.parseLicenseKey(testingLicense().licenseKey);
    if (!signed) throw new Error("the testing licence did not parse");
    // An older release's `z.object` drops the claims it does not declare.
    const asAnOlderReleaseReadsIt = licenseDataSchema
      .omit({ kind: true, instanceId: true })
      .parse(signed.data);

    expect(
      cryptography.verifySignature({ data: asAnOlderReleaseReadsIt, signature: signed.signature }),
    ).toBe(false);
  });
});

describe("given a licence signed before testing licences existed", () => {
  /** @scenario "A license with no kind is a standard license" */
  it("reads as a standard licence that verifies byte for byte, and a new standard one adds no claim", () => {
    const signed = cryptography.parseLicenseKey(VALID_LICENSE_KEY);
    const { licenseData } = generation.generate({
      organizationName: "Acme",
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers: 5,
      privateKey: TEST_PRIVATE_KEY,
    });

    expect(signed?.data.kind).toBeUndefined();
    expect(signed !== null && cryptography.verifySignature(signed)).toBe(true);
    expect(Object.keys(licenseData)).not.toContain("kind");
    expect(Object.keys(licenseData)).not.toContain("instanceId");
  });
});

describe("given a testing licence uploaded to an install", () => {
  /** @scenario "A testing license is refused on another instance or organization" */
  it("refuses it on another instance with a code naming the instance, and stores nothing", async () => {
    const { service, storage } = install({ instanceId: "instance-b" });

    const result = await service.validateAndStoreLicense({
      organizationId: "org-local",
      licenseKey: testingLicense().licenseKey,
    });

    expect(result).toEqual({ success: false, error: LICENSE_ERRORS.TESTING_WRONG_INSTANCE });
    expect(licenseValidationError(LICENSE_ERRORS.TESTING_WRONG_INSTANCE).code).toBe(
      "testing_license_wrong_instance",
    );
    expect(storage.stored.size).toBe(0);
  });

  /** @scenario "A testing license is refused on another instance or organization" */
  it("refuses it for another organization with a code naming the organization", async () => {
    const { service, storage } = install();

    const result = await service.validateAndStoreLicense({
      organizationId: "org-other",
      licenseKey: testingLicense().licenseKey,
    });

    expect(result).toEqual({ success: false, error: LICENSE_ERRORS.TESTING_WRONG_ORGANIZATION });
    expect(licenseValidationError(LICENSE_ERRORS.TESTING_WRONG_ORGANIZATION).code).toBe(
      "testing_license_wrong_organization",
    );
    expect(storage.stored.size).toBe(0);
  });

  /** @scenario "A testing license is refused on another instance or organization" */
  it("grants no plan and no single sign-on when a copied one sits on another instance", async () => {
    const { service, storage } = install({ instanceId: "instance-b" });
    await storage.storeLicense("org-local", {
      licenseKey: testingLicense().licenseKey,
      expiresAt: EXPIRES,
      validatedAt: ISSUED,
    });

    await expect(service.getSelfHostedPlan("org-local")).resolves.toBe(UNLIMITED_PLAN);
    await expect(service.getActivePlan("org-local")).resolves.toBe(UNLIMITED_PLAN);
    await expect(service.isPlatformSsoLicensed({ isSaas: false })).resolves.toBe(false);
    const access = await service.inspectPlatformAccess();
    expect(access.inspections).toEqual([
      expect.objectContaining({ valid: false, reason: "instance_mismatch" }),
    ]);
  });

  /** @scenario "A testing license is refused on another instance or organization" */
  it("refuses it everywhere while configuration names the instance id, even a matching one", async () => {
    const { service, storage } = install({ instanceIdOverridden: true });
    const { licenseKey } = testingLicense();

    const result = await service.validateAndStoreLicense({
      organizationId: "org-local",
      licenseKey,
    });
    await storage.storeLicense("org-local", {
      licenseKey,
      expiresAt: EXPIRES,
      validatedAt: ISSUED,
    });

    expect(result).toEqual({ success: false, error: LICENSE_ERRORS.TESTING_INSTANCE_OVERRIDE });
    expect(licenseValidationError(LICENSE_ERRORS.TESTING_INSTANCE_OVERRIDE).code).toBe(
      "testing_license_instance_override",
    );
    await expect(service.getSelfHostedPlan("org-local")).resolves.toBe(UNLIMITED_PLAN);
    await expect(service.getActivePlan("org-local")).resolves.toBe(UNLIMITED_PLAN);
    await expect(service.isPlatformSsoLicensed({ isSaas: false })).resolves.toBe(false);
    expect((await service.inspectPlatformAccess()).inspections).toEqual([
      expect.objectContaining({ valid: false, reason: "instance_override" }),
    ]);
  });

  /** @scenario "A testing license is refused on another instance or organization" */
  it("refuses it when the install cannot say which instance it is", async () => {
    const { service } = install({ instanceId: () => Promise.reject(new Error("no identity")) });

    const result = await service.validateAndStoreLicense({
      organizationId: "org-local",
      licenseKey: testingLicense().licenseKey,
    });

    expect(result).toEqual({ success: false, error: LICENSE_ERRORS.TESTING_WRONG_INSTANCE });
  });
});

describe("given an install holding a testing licence", () => {
  /** @scenario "An expired testing license grants nothing, without a restart" */
  it("falls back to the open-source plan and stops single sign-on once the term passes", async () => {
    const { service, advance } = install();
    const stored = await service.validateAndStoreLicense({
      organizationId: "org-local",
      licenseKey: testingLicense().licenseKey,
    });
    expect(stored.success).toBe(true);
    await expect(service.getSelfHostedPlan("org-local")).resolves.toMatchObject({
      type: "ENTERPRISE",
    });
    await expect(service.isPlatformSsoLicensed({ isSaas: false })).resolves.toBe(true);

    advance({ hours: 4 * 24, seconds: 1 });

    await expect(service.getSelfHostedPlan("org-local")).resolves.toBe(UNLIMITED_PLAN);
    await expect(service.isPlatformSsoLicensed({ isSaas: false })).resolves.toBe(false);
    await expect(service.getLicenseStatus("org-local")).resolves.toMatchObject({
      hasLicense: true,
      valid: false,
      expired: true,
    });
  });

  /** @scenario "An expired testing license grants nothing, without a restart" */
  it("reads the store again after a minute rather than keeping the allow for the process", async () => {
    const { service, storage, advance } = install();
    await service.validateAndStoreLicense({
      organizationId: "org-local",
      licenseKey: testingLicense().licenseKey,
    });

    await service.isPlatformSsoLicensed({ isSaas: false });
    const scansAfterFirst = storage.listCalls;
    await service.isPlatformSsoLicensed({ isSaas: false });
    expect(storage.listCalls).toBe(scansAfterFirst);

    advance({ seconds: 61 });
    await expect(service.isPlatformSsoLicensed({ isSaas: false })).resolves.toBe(true);
    expect(storage.listCalls).toBe(scansAfterFirst + 1);
    const access = await service.inspectPlatformAccess();
    expect(access.allowedUntil).toBeDefined();
  });
});

describe("given an install holding a standard licence past its expiry", () => {
  /** @scenario "An expired standard license keeps today's behaviour" */
  it("keeps its plan and a single sign-on allow for the process, never asking for the instance", async () => {
    const { service, storage, advance, asked } = install();
    await storage.storeLicense("org-local", {
      licenseKey: EXPIRED_ENTERPRISE_LICENSE_KEY,
      expiresAt: Temporal.Instant.from("2020-01-01T00:00:00Z"),
      validatedAt: ISSUED,
    });

    await expect(service.getSelfHostedPlan("org-local")).resolves.toMatchObject({
      type: "ENTERPRISE",
      maxMembers: 100,
    });
    await expect(service.getActivePlan("org-local")).resolves.toBe(UNLIMITED_PLAN);
    await expect(service.isPlatformSsoLicensed({ isSaas: false })).resolves.toBe(true);
    const scans = storage.listCalls;
    advance({ hours: 365 * 24 });
    await expect(service.isPlatformSsoLicensed({ isSaas: false })).resolves.toBe(true);

    expect(storage.listCalls).toBe(scans);
    expect((await service.inspectPlatformAccess()).allowedUntil).toBeUndefined();
    expect(asked.instanceId).toBe(0);
  });
});
