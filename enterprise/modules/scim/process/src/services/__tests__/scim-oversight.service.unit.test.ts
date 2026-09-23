// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The operator's directory-sync oversight (ADR-122), over in-memory stand-ins
 * for storage only: the refusals, the ordering and the idempotency are the
 * service's own. specs/identity/scim-reconciliation-surfaces.feature
 */
import type { ScimSyncFailure, ScimSyncState } from "@langwatch/identity-contract";
import { fromDate } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
import { ScimOversightService } from "../scim-oversight.service.ts";

const ORG = "org_acme";
const CONNECTION = "acme-okta";
const RETIRED_AT = 1_756_000_002_000;
const OPERATOR = { userId: "user_ops" };

function failure(overrides: Partial<ScimSyncFailure> = {}): ScimSyncFailure {
  return {
    op: "deactivate_user",
    errorCode: "offboard_incomplete",
    attempts: 5,
    retiredAtMs: RETIRED_AT,
    redrivenAtMs: null,
    userId: "user_sam",
    occurredAtMs: RETIRED_AT,
    ...overrides,
  };
}

function sync(overrides: Partial<ScimSyncState> = {}): ScimSyncState {
  return {
    scimSyncId: CONNECTION,
    connectionId: CONNECTION,
    organizationId: ORG,
    state: "ERROR",
    lastPushedAtMs: 1_756_000_001_000,
    lastFailure: failure(),
    deadLetters: [failure()],
    revokedCause: null,
    createdAtMs: 1_756_000_000_000,
    updatedAtMs: RETIRED_AT,
    ...overrides,
  };
}

/** Everything that happened, in order: the ordering is a promise here. */
let order: string[];
let held: ScimSyncState | null;
let listed: unknown[];
let removals: unknown[];
let redriven: unknown[];
let failRemoval: Error | null;
let identities: MemoryScimRepository;
let service: ScimOversightService;

function build(initial: ScimSyncState | null): void {
  order = [];
  held = initial;
  listed = [];
  removals = [];
  redriven = [];
  failRemoval = null;
  identities = MemoryScimRepository.create();
  service = ScimOversightService.create({
    syncs: () => ({
      listForOperator: async (input) => {
        listed.push(input);
        return { syncs: held ? [held] : [], total: held ? 1 : 0 };
      },
      findForOperator: async () => (held ? [held] : []),
    }),
    organizations: {
      findProvisioningSummary: async (organizationId) =>
        organizationId === ORG
          ? { id: ORG, name: "Acme", slug: "acme", createdAt: fromDate(new Date(0)) }
          : null,
    },
    identities,
    lifecycle: {
      applyRedriven: async (input) => {
        order.push("recorded");
        redriven.push(input);
        // The fact the guard would state, folded into the next read.
        if (!held) return;
        held = {
          ...held,
          deadLetters: held.deadLetters.map((letter) =>
            letter.retiredAtMs === RETIRED_AT
              ? { ...letter, redrivenAtMs: RETIRED_AT + 1_000 }
              : letter,
          ),
        };
      },
    },
    deprovision: {
      removeAccess: async (input) => {
        if (failRemoval) throw failRemoval;
        order.push("applied");
        removals.push(input);
        return { ownedApiKeys: [], personalTeams: [] };
      },
    },
  });
}

function redrive() {
  return service.redriveRetiredApply({
    connectionId: CONNECTION,
    retiredAtMs: RETIRED_AT,
    operator: OPERATOR,
  });
}

async function refusalOf(attempt: Promise<unknown>): Promise<{ code?: string }> {
  return attempt.then(
    () => ({}),
    (error: unknown) => error as { code?: string },
  );
}

beforeEach(() => build(sync()));

describe("the operator's directory sync oversight", () => {
  describe("given an apply retired as unretryable whose cause has been fixed", () => {
    /** @scenario "Re-driving a retired apply is a recorded act" */
    it("runs the removal again, then stamps the letter with the operator", async () => {
      await expect(redrive()).resolves.toEqual({ applied: true });

      expect(removals).toEqual([
        {
          userId: "user_sam",
          organizationId: ORG,
          connectionId: CONNECTION,
          op: "deactivate_user",
        },
      ]);
      expect(redriven).toEqual([
        {
          organizationId: ORG,
          connectionId: CONNECTION,
          retiredAtMs: RETIRED_AT,
          operator: OPERATOR,
        },
      ]);
      expect(order).toEqual(["applied", "recorded"]);
    });

    it("leaves the letter re-drivable when the removal fails", async () => {
      failRemoval = new Error("grants service is down");

      await expect(redrive()).rejects.toThrow(/grants service is down/);
      expect(redriven).toEqual([]);
    });

    /** @scenario "Re-driving twice applies once" */
    it("applies the directory's operation exactly once when re-driven twice", async () => {
      await redrive();
      await expect(redrive()).resolves.toEqual({ applied: false });

      expect(removals).toHaveLength(1);
      expect(redriven).toHaveLength(1);
    });
  });

  describe("given an apply that is still being retried", () => {
    /** @scenario "An apply that is not retired cannot be re-driven" */
    it("refuses it by name and runs nothing", async () => {
      build(sync({ lastFailure: failure({ retiredAtMs: null, attempts: 2 }), deadLetters: [] }));

      expect(await refusalOf(redrive())).toMatchObject({ code: "scim_apply_not_retired" });
      expect(removals).toEqual([]);
      expect(redriven).toEqual([]);
    });
  });

  describe("given a retired apply the history cannot reconstruct", () => {
    it("refuses an addition by name rather than inventing a push", async () => {
      build(sync({ deadLetters: [failure({ op: "push_user", errorCode: "validation_error" })] }));

      expect(await refusalOf(redrive())).toMatchObject({ code: "scim_apply_not_redrivable" });
      expect(removals).toEqual([]);
    });
  });

  describe("given a connection the operator names that has no sync", () => {
    it("refuses rather than answering as though there were nothing to do", async () => {
      build(null);

      expect(await refusalOf(redrive())).toMatchObject({ code: "scim_apply_not_retired" });
    });
  });

  describe("when the operator lists every customer's connections", () => {
    /** @scenario "Every customer's connections are one operator list" */
    it("lists them across organizations with names, states and a total to page by", async () => {
      const page = await service.list({ page: 0, pageSize: 25 });

      expect(page.total).toBe(1);
      expect(page.syncs).toEqual([
        expect.objectContaining({
          connectionId: CONNECTION,
          organizationId: ORG,
          organizationName: "Acme",
          state: "ERROR",
        }),
      ]);
      expect(listed).toEqual([{ page: 0, pageSize: 25 }]);
    });

    /** @scenario "A dead letter opens to the intent behind it" */
    it("opens a failure to the retired intent, its error and its retry history", async () => {
      const [opened] = await service.find({ connectionId: CONNECTION });

      expect(opened?.deadLetters).toEqual([
        expect.objectContaining({
          op: "deactivate_user",
          errorCode: "offboard_incomplete",
          attempts: 5,
          retiredAtMs: RETIRED_AT,
          redrivenAtMs: null,
          userId: "user_sam",
        }),
      ]);
    });
  });

  describe("when the operator opens a person the directory manages", () => {
    /** @scenario "The mapping detail is the operator's, not the customer's" */
    it("shows the identifier the directory knows them by, per connection", async () => {
      await identities.rememberDirectoryIdentity({
        connectionId: CONNECTION,
        externalId: "u-1",
        userId: "user_sam",
      });
      await identities.rememberDirectoryIdentity({
        connectionId: "other-connection",
        externalId: "u-1",
        userId: "user_other",
      });

      const mapped = await service.findDirectoryIdentities({ connectionId: CONNECTION });

      expect(mapped).toEqual([
        expect.objectContaining({
          connectionId: CONNECTION,
          externalId: "u-1",
          userId: "user_sam",
        }),
      ]);
    });
  });
});
