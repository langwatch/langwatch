/**
 * The identity this install presents: one UUID, minted on first use, naming one
 * install rather than one organization, and serving both hosts.
 * `LANGWATCH_CONNECT_INSTANCE_ID` names it instead (ADR-156, section 6).
 */

import type { InstanceIdentityView } from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

import type {
  InstanceIdentityRecord,
  InstanceIdentityRepository,
  InstanceReportSwitches,
} from "../repositories/instance-identity.repository.ts";

interface InstanceIdentityServiceDependencies {
  readonly repository: InstanceIdentityRepository;
  /** A fresh UUID. Supplied, so a suite mints a predictable one. */
  readonly newInstanceId: () => string;
  /** The identity an operator named instead of the one this install minted. */
  readonly instanceIdOverride?: string;
}

export class InstanceIdentityService {
  /**
   * Held for the life of the process. The id never changes once minted, and the
   * seat guard asks for it on a path that already reads three rows.
   */
  #held: string | undefined;

  static create(deps: InstanceIdentityServiceDependencies): InstanceIdentityService {
    return new InstanceIdentityService(deps);
  }

  private constructor(private readonly deps: InstanceIdentityServiceDependencies) {}

  /** The identity this install presents, minting it on first use. */
  async getInstanceId(): Promise<string> {
    const override = this.deps.instanceIdOverride;
    if (override) return override;
    if (this.#held) return this.#held;

    const existing = await this.deps.repository.findRow();
    const row = existing ?? (await this.deps.repository.mint(this.deps.newInstanceId()));
    this.#held = row.instanceId;
    return this.#held;
  }

  /**
   * The identity row this install holds; empty where it minted none, and at
   * most one. What a reader asks for: a path reporting where the install
   * stands has no business minting an identity or writing anything.
   */
  async findIdentity(): Promise<InstanceIdentityRecord[]> {
    const row = await this.deps.repository.findRow();
    if (!row) return [];
    this.#held = row.instanceId;
    return [row];
  }

  /** The row as the usage report and the checkup read it; empty where none was minted. */
  async findView(): Promise<InstanceIdentityView[]> {
    const rows = await this.findIdentity();
    return rows.map((row) => ({
      instanceId: row.instanceId,
      createdAt: iso(row.createdAt),
      ...(row.lastReportAt ? { lastReportAt: iso(row.lastReportAt) } : {}),
      ...(row.lastReportError ? { lastReportError: row.lastReportError } : {}),
      optionalMetricsOptOut: row.optionalMetricsOptOut,
      hostnameOptOut: row.hostnameOptOut,
    }));
  }

  async setReportSwitches(switches: InstanceReportSwitches): Promise<void> {
    await this.deps.repository.setReportSwitches({
      switches,
      instanceIdIfMissing: this.#idForAMissingRow(),
    });
  }

  async recordReport(params: { error: string | null; at: Instant }): Promise<void> {
    await this.deps.repository.recordReport({
      ...params,
      instanceIdIfMissing: this.#idForAMissingRow(),
    });
  }

  /** The id a write creates the row under when none exists; ignored when one does. */
  #idForAMissingRow(): string {
    return this.#held ?? this.deps.instanceIdOverride ?? this.deps.newInstanceId();
  }
}

function iso(instant: Instant): string {
  return instant.toString({ fractionalSecondDigits: 3 });
}
