import type { ServingRosterEntry } from "@langwatch/upgrade";
import type { UpgradeStepDetail } from "@langwatch/upgrade/reader";
import { describe, expect, it } from "vitest";

import type { UpgradeLedgerRepository } from "../../repositories/upgrade-ledger.repository.ts";
import { QueueClaimsIndexReadinessService } from "../queue-claims-index-readiness.service.ts";
import { stepOf } from "./support/upgrade-ledger.ts";

const FILL_STEP = "ops:fill-queue-tenant-claims";

function processShipping(steps: string[]): ServingRosterEntry {
  const at = new Date("2026-11-26T10:00:00Z");
  return {
    processId: "p",
    role: "worker",
    image: "i",
    release: null,
    steps,
    startedAt: at,
    heartbeatAt: at,
  };
}

/** A ledger whose fill step has `status` and whose live roster is `roster`. */
function ledgerWith({
  status,
  roster,
}: {
  status: string;
  roster: ServingRosterEntry[];
}): Pick<UpgradeLedgerRepository, "getStep" | "findLiveRoster"> {
  return {
    getStep: async ({ id }) =>
      ({ ...stepOf({ id, status, mode: "background" }), targets: [] }) satisfies UpgradeStepDetail,
    findLiveRoster: async () => roster,
  };
}

const readiness = (ledger: Pick<UpgradeLedgerRepository, "getStep" | "findLiveRoster">) =>
  QueueClaimsIndexReadinessService.create({ ledger, staleAfterMs: 600_000 }).isReady();

describe("queue claims index readiness", () => {
  /** @scenario "An operator replay trusts the queue's claimed-groups index only once its backfill is done and no older image serves" */
  it("is ready only when the fill step is settled and every live process ships it", async () => {
    const current = processShipping([FILL_STEP]);
    const older = processShipping([]);

    expect(await readiness(ledgerWith({ status: "done", roster: [current] }))).toBe(true);
    expect(await readiness(ledgerWith({ status: "not-needed", roster: [current] }))).toBe(true);
    expect(await readiness(ledgerWith({ status: "pending", roster: [current] }))).toBe(false);
    expect(await readiness(ledgerWith({ status: "done", roster: [current, older] }))).toBe(false);
  });
});
