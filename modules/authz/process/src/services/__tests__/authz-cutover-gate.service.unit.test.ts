import { createTestLogger } from "@langwatch/test-harness";
import { Temporal } from "@langwatch/time";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthzCutoverRepository } from "../../repositories/authz-cutover.repository.ts";
import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzCutoverRepository } from "../../repositories/memory/memory.authz.repositories.ts";
import type { AuthzEngineSwitch } from "../../rules/authz-engine-switch.rules.ts";
import {
  AuthzCutoverGateService,
  ENGINE_GATE_CACHE_TTL_MS,
} from "../authz-cutover-gate.service.ts";

const ORG_ID = "org_gate";
const SWITCHED_AT = Temporal.Instant.from("2026-08-18T09:00:00.000Z");

/** A repository answering the switches it is handed, in order, then the last one. */
class ScriptedCutoverRepository extends AuthzCutoverRepository {
  readonly reads = vi.fn<(input: { organizationId: string }) => Promise<AuthzEngineSwitch>>();

  async getEngineSwitch(input: { organizationId: string }): Promise<AuthzEngineSwitch> {
    return this.reads(input);
  }

  async carryOverEngineSwitch(): Promise<number> {
    return 0;
  }

  async switchOnEngine(): Promise<boolean> {
    return true;
  }

  async pinEngineSwitch(): Promise<void> {}
}

function gateOver({ onEngine }: { onEngine: boolean | null }) {
  const memory = AuthzMemoryStore.create();
  if (onEngine !== null) {
    memory.cutovers.set(ORG_ID, { organizationId: ORG_ID, onEngine, switchedAt: SWITCHED_AT });
  }
  return AuthzCutoverGateService.create({
    repository: MemoryAuthzCutoverRepository.create({ memory }),
  });
}

describe("AuthzCutoverGateService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "Only a finalized migration counts as cut over" */
  it.each([
    [true, true],
    [false, false],
    [null, false],
  ])("reads an engine switch of %s as on-engine=%s", async (onEngine, expected) => {
    await expect(gateOver({ onEngine }).isOn({ organizationId: ORG_ID })).resolves.toBe(expected);
  });

  /** @scenario "A failed migration-state read is reported" */
  it("reports a failed switch read and fails safe to legacy", async () => {
    const repository = new ScriptedCutoverRepository();
    repository.reads.mockRejectedValue(new Error("pg is down"));
    const { logger, lines } = createTestLogger();
    const gate = AuthzCutoverGateService.create({ repository, logger });

    await expect(gate.isOn({ organizationId: ORG_ID })).resolves.toBe(false);
    expect(lines.findLine("warn", "could not read the authz migration state")).toMatchObject({
      organizationId: ORG_ID,
      ttlMs: ENGINE_GATE_CACHE_TTL_MS,
    });
  });

  it("returns the switch time only while the engine answers", async () => {
    await expect(
      gateOver({ onEngine: true }).findFinalizedAt({ organizationId: ORG_ID }),
    ).resolves.toEqual(SWITCHED_AT);
    await expect(
      gateOver({ onEngine: false }).findFinalizedAt({ organizationId: ORG_ID }),
    ).resolves.toBeNull();
  });

  it("raises through the uncached read used by revocation routing", async () => {
    const repository = new ScriptedCutoverRepository();
    repository.reads.mockRejectedValue(new Error("pg is down"));
    const gate = AuthzCutoverGateService.create({ repository });

    await expect(gate.readUncached({ organizationId: ORG_ID })).rejects.toThrow("pg is down");
  });

  it("coalesces repeated reads inside the cache window", async () => {
    const repository = new ScriptedCutoverRepository();
    repository.reads.mockResolvedValue({ onEngine: true, switchedAt: SWITCHED_AT });
    const gate = AuthzCutoverGateService.create({ repository });

    await gate.isOn({ organizationId: ORG_ID });
    await gate.isOn({ organizationId: ORG_ID });

    expect(repository.reads).toHaveBeenCalledTimes(1);
  });

  /** @scenario "Rolling back returns an organization to the legacy path within the gate's cache window" */
  it("observes rollback after the cache TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T09:00:00.000Z"));
    const repository = new ScriptedCutoverRepository();
    repository.reads
      .mockResolvedValueOnce({ onEngine: true, switchedAt: SWITCHED_AT })
      .mockResolvedValue({ onEngine: false, switchedAt: SWITCHED_AT });
    const gate = AuthzCutoverGateService.create({ repository });

    await expect(gate.isOn({ organizationId: ORG_ID })).resolves.toBe(true);
    vi.setSystemTime(new Date("2026-08-18T09:05:00.000Z"));
    await expect(gate.isOn({ organizationId: ORG_ID })).resolves.toBe(false);
  });
});
