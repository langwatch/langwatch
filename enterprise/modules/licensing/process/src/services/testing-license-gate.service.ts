import {
  LICENSE_ERRORS,
  type LicenseData,
  type LicenseError,
  type PlatformLicenseInspection,
} from "@langwatch/enterprise-licensing-contract";
import { Temporal, type Instant } from "@langwatch/time";

import {
  isTestingLicense,
  testingLicenseCacheUntilMs,
  testingLicenseVerdict,
  type TestingLicenseVerdict,
} from "../rules/testing-license.rules.ts";

/** One licence judged for the platform gate, and when a testing licence's allow ends. */
export type PlatformLicenseVerdict = {
  inspection: PlatformLicenseInspection;
  allowedUntil?: string;
};

type TestingLicenseGateOptions = {
  /** `LicensingApi.getInstanceId`; where none is wired, every testing licence is refused. */
  instanceId: (() => Promise<string>) | undefined;
  /** `LANGWATCH_CONNECT_INSTANCE_ID` is set: every testing licence is refused (ADR-180). */
  instanceIdOverridden: boolean;
  now: () => Instant;
};

/** Whether a testing licence holds: unexpired, on its instance, for its organization (ADR-180). */
export class TestingLicenseGateService {
  static create(options: TestingLicenseGateOptions): TestingLicenseGateService {
    return new TestingLicenseGateService(options);
  }

  private constructor(private readonly options: TestingLicenseGateOptions) {}

  /** A failed identity read refuses a testing licence rather than failing the read. */
  findInstanceId(): Promise<string | undefined> {
    const { instanceId } = this.options;
    return instanceId ? instanceId().catch(() => undefined) : Promise.resolve(undefined);
  }

  /** Every standard licence passes; a testing one must be unexpired, here, for `organizationId`. */
  async judge({
    license,
    organizationId,
  }: {
    license: LicenseData;
    organizationId: string;
  }): Promise<TestingLicenseVerdict> {
    if (!isTestingLicense(license)) return { honoured: true };
    return testingLicenseVerdict({
      license,
      instanceId: await this.findInstanceId(),
      instanceIdOverridden: this.options.instanceIdOverridden,
      organizationId,
      now: this.options.now(),
    });
  }

  /** A testing licence at the platform gate; an allow lasts to its expiry, at most a minute. */
  async inspectPlatform({
    license,
    source,
    genuine,
    now,
    instanceId,
  }: {
    license: LicenseData;
    source: Pick<PlatformLicenseInspection, "source" | "organizationId">;
    genuine: Pick<
      Extract<PlatformLicenseInspection, { valid: true }>,
      "source" | "organizationId" | "expiresAt" | "organizationName"
    >;
    now: Instant;
    instanceId: () => Promise<string | undefined>;
  }): Promise<PlatformLicenseVerdict> {
    const verdict = testingLicenseVerdict({
      license,
      instanceId: await instanceId(),
      instanceIdOverridden: this.options.instanceIdOverridden,
      organizationId: source.organizationId,
      now,
    });
    if (!verdict.honoured) {
      return {
        inspection: { ...source, valid: false, reason: platformInspectionReasonOf(verdict.error) },
      };
    }
    const until = testingLicenseCacheUntilMs({ license, now });
    return {
      inspection: { ...genuine, valid: true, expired: false },
      allowedUntil: Temporal.Instant.fromEpochMilliseconds(until).toString(),
    };
  }
}

/** Why the platform gate refused a testing licence, in the inspection's own words. */
function platformInspectionReasonOf(
  error: LicenseError,
): "expired" | "instance_mismatch" | "instance_override" | "organization_mismatch" {
  if (error === LICENSE_ERRORS.EXPIRED) return "expired";
  if (error === LICENSE_ERRORS.TESTING_INSTANCE_OVERRIDE) return "instance_override";
  if (error === LICENSE_ERRORS.TESTING_WRONG_INSTANCE) return "instance_mismatch";
  return "organization_mismatch";
}
