// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import { describe, expect, it } from "vitest";

import type { CustomerIoPlanResyncPeers } from "../../services/customer-io-plan-resync.service.ts";
import {
  CustomerIoPlanResyncTask,
  runCustomerIoPlanResync,
} from "../customer-io-plan-resync.task.ts";

/** Three organizations, two a page; org_b has no active member. */
const MEMBERS = new Map([
  ["org_a", 2],
  ["org_b", 0],
  ["org_c", 250],
]);
const ORGANIZATIONS = [...MEMBERS.keys()];

/** An organization twin serving two ids a page and a catch-up recording each call. */
function peersOver() {
  const caughtUp: { organizationId: string; isDryRun: boolean }[] = [];
  const peers: CustomerIoPlanResyncPeers = {
    organizations: {
      listIds: async (input) => {
        const from = input?.after === undefined ? 0 : ORGANIZATIONS.indexOf(input.after) + 1;
        const ids = ORGANIZATIONS.slice(from, from + 2);
        return { ids, next: from + 2 < ORGANIZATIONS.length ? (ids.at(-1) ?? null) : null };
      },
    },
    catchUp: async (input) => {
      caughtUp.push(input);
      return { members: MEMBERS.get(input.organizationId) ?? 0 };
    },
  };
  return { caughtUp, peers };
}

const TOTALS = {
  afterOrganizationId: "org_c",
  organizations: 3,
  members: 252,
  maxGroupCalls: 2,
  maxIdentifies: 252,
  skipped: { no_active_members: 1 },
};

const signal = new AbortController().signal;

describe("runCustomerIoPlanResync", () => {
  describe("when execute is false", () => {
    /** @scenario "Running the resync task without --execute sends nothing" */
    it("only reads, records no fact and reports what a real run would send", async () => {
      const { caughtUp, peers } = peersOver();

      const outcome = await runCustomerIoPlanResync({ peers, execute: false, signal });

      expect(caughtUp).toHaveLength(ORGANIZATIONS.length);
      expect(caughtUp.every(({ isDryRun }) => isDryRun)).toBe(true);
      expect(outcome).toEqual({
        dryRun: { ...TOTALS, factsRecorded: 0, dryRun: true, aborted: false },
        executed: null,
      });
    });
  });

  describe("when execute is true", () => {
    /** @scenario "Running the resync task with --execute prints the dry run totals, then sends" */
    it("runs a dry run over every organization first, then records a fact per organization with members", async () => {
      const { caughtUp, peers } = peersOver();

      const outcome = await runCustomerIoPlanResync({ peers, execute: true, signal });

      expect(caughtUp).toEqual([
        ...ORGANIZATIONS.map((organizationId) => ({ organizationId, isDryRun: true })),
        ...ORGANIZATIONS.map((organizationId) => ({ organizationId, isDryRun: false })),
      ]);
      expect(outcome).toEqual({
        dryRun: { ...TOTALS, factsRecorded: 0, dryRun: true, aborted: false },
        executed: { ...TOTALS, factsRecorded: 2, dryRun: false, aborted: false },
      });
    });

    it("does not start the real run when aborted after the dry run", async () => {
      const { caughtUp, peers } = peersOver();
      const controller = new AbortController();
      controller.abort();

      const outcome = await runCustomerIoPlanResync({
        peers,
        execute: true,
        signal: controller.signal,
      });

      expect(outcome.executed).toBeNull();
      expect(caughtUp.every(({ isDryRun }) => isDryRun)).toBe(true);
    });
  });
});

describe("CustomerIoPlanResyncTask", () => {
  it("is named customer-io-plan-resync and runs only a dry run without --execute", async () => {
    const { caughtUp, peers } = peersOver();
    const task = CustomerIoPlanResyncTask.create({ peers });
    expect(task.name).toBe("customer-io-plan-resync");

    await task.run({ args: [], signal });

    expect(caughtUp.every(({ isDryRun }) => isDryRun)).toBe(true);
  });

  it("records with --execute", async () => {
    const { caughtUp, peers } = peersOver();
    const task = CustomerIoPlanResyncTask.create({ peers });

    await task.run({ args: ["--execute"], signal });

    expect(caughtUp.filter(({ isDryRun }) => !isDryRun)).toHaveLength(ORGANIZATIONS.length);
  });
});
