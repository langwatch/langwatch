/** Spec: modules/automation/specs/automation.feature (the Slack claim step) */
import {
  SlackIntegrationMissingError,
  type SlackApi,
  type SlackConnectionClaim,
} from "@langwatch/slack-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  AutomationSlackClaimReconcileService,
  type SlackClaimReconcileCursor,
} from "../../features/slack/services/automation-slack-claim-reconcile.service.ts";
import { MemoryAutomationStore } from "../../repositories/memory/memory.automation.store.ts";
import { MemoryTriggerRepository } from "../../repositories/memory/memory.trigger.repository.ts";

const PROJECT = "project-1";
const UNUSABLE = "c-gone";

/** Slack's claims as a two-claim page source; a release drops the claim from it. */
function slackOver(claims: SlackConnectionClaim[]) {
  const released: string[] = [];
  const slack = createApiFixture<SlackApi>({
    listSlackConnectionClaims: ({ after }) => {
      const start = after === undefined ? 0 : Number(after);
      const page = claims.slice(start, start + 2);
      const end = start + page.length;
      return Promise.resolve({ claims: page, next: end < claims.length ? String(end) : null });
    },
    releaseConnection: ({ connectionId, claimantId }) => {
      released.push(`${connectionId}:${claimantId}`);
      return Promise.resolve();
    },
  });
  return { slack, released };
}

/** Automation's claim mover, recording each claim; an unusable connection is refused. */
function claimMover() {
  const claimed: string[] = [];
  return {
    claimed,
    slackConnections: {
      updateConnectionClaim: ({
        trigger,
        after,
      }: {
        projectId: string;
        trigger: { id: string; name: string };
        before: undefined;
        after: { actionParams: unknown; active: boolean } | undefined;
      }) => {
        const { slackIntegrationId } = (after?.actionParams ?? {}) as {
          slackIntegrationId?: string;
        };
        if (slackIntegrationId === UNUSABLE) throw new SlackIntegrationMissingError();
        claimed.push(`${slackIntegrationId}:${trigger.id}:${trigger.name}`);
        return Promise.resolve();
      },
    },
  };
}

function claimOf({
  connectionId,
  claimantId,
}: {
  connectionId: string;
  claimantId: string;
}): SlackConnectionClaim {
  return { connectionId, projectId: PROJECT, claimant: { id: claimantId, label: claimantId } };
}

async function slackTrigger({
  triggers,
  id,
  connectionId,
}: {
  triggers: MemoryTriggerRepository;
  id: string;
  connectionId: string;
}) {
  return triggers.create({
    id,
    projectId: PROJECT,
    name: `Alert ${id}`,
    action: "SEND_SLACK_MESSAGE",
    actionParams: { slackIntegrationId: connectionId, slackDelivery: "webhook" },
  });
}

/** Active, paused, deleted, moved and unusable automations, and claims held by each but one. */
async function setup() {
  const triggers = MemoryTriggerRepository.create(MemoryAutomationStore.create());
  await slackTrigger({ triggers, id: "active", connectionId: "c1" });
  await slackTrigger({ triggers, id: "paused", connectionId: "c1" });
  await triggers.update({ id: "paused", projectId: PROJECT, active: false });
  await slackTrigger({ triggers, id: "deleted", connectionId: "c1" });
  await triggers.update({ id: "deleted", projectId: PROJECT, deleted: true });
  await slackTrigger({ triggers, id: "moved", connectionId: "c2" });
  await slackTrigger({ triggers, id: "unusable", connectionId: UNUSABLE });
  const { slack, released } = slackOver([
    claimOf({ connectionId: "c1", claimantId: "active" }),
    claimOf({ connectionId: "c1", claimantId: "paused" }),
    claimOf({ connectionId: "c1", claimantId: "deleted" }),
    claimOf({ connectionId: "c1", claimantId: "moved" }),
    claimOf({ connectionId: "c1", claimantId: "gone" }),
  ]);
  const mover = claimMover();
  const service = AutomationSlackClaimReconcileService.create({
    slack,
    triggers,
    slackConnections: mover.slackConnections,
  });
  return { service, released, claimed: mover.claimed };
}

describe("AutomationSlackClaimReconcileService", () => {
  describe("given active, paused, deleted, moved and unusable Slack automations", () => {
    describe("when the reconcile runs", () => {
      /** @scenario "The Slack claim step skips an automation whose connection it can no longer use" */
      it("claims each active automation's connection and skips the unusable one", async () => {
        const { service, claimed } = await setup();

        const outcome = await service.reconcile({ dryRun: false });

        expect(claimed).toEqual(["c1:active:Alert active", "c2:moved:Alert moved"]);
        expect(outcome).toMatchObject({ claimed: 2, skipped: 1 });
      });

      it("releases every claim but the active automation's on its own connection", async () => {
        const { service, released } = await setup();

        const outcome = await service.reconcile({ dryRun: false });

        expect(released).toEqual(["c1:paused", "c1:deleted", "c1:moved", "c1:gone"]);
        expect(outcome).toMatchObject({ released: 4, kept: 1 });
      });

      it("hands a cursor for every page, claim phase first, release phase last", async () => {
        const { service } = await setup();
        const cursors: SlackClaimReconcileCursor[] = [];

        await service.reconcile({
          dryRun: false,
          onPage: ({ cursor }) => {
            cursors.push(cursor);
            return Promise.resolve();
          },
        });

        expect(cursors).toEqual([
          { phase: "claim", after: "unusable" },
          { phase: "release", after: null },
          { phase: "release", after: "2" },
          { phase: "release", after: "4" },
          { phase: "release", after: null },
        ]);
      });
    });

    describe("when the reconcile resumes in its release phase", () => {
      it("claims nothing and releases only after the cursor", async () => {
        const { service, claimed, released } = await setup();

        await service.reconcile({ from: { phase: "release", after: "2" }, dryRun: false });

        expect(claimed).toEqual([]);
        expect(released).toEqual(["c1:deleted", "c1:moved", "c1:gone"]);
      });
    });

    describe("when the reconcile resumes in its claim phase", () => {
      it("claims only after the cursor, then releases from the start", async () => {
        const { service, claimed, released } = await setup();

        await service.reconcile({ from: { phase: "claim", after: "deleted" }, dryRun: false });

        expect(claimed).toEqual(["c2:moved:Alert moved"]);
        expect(released).toHaveLength(4);
      });
    });

    describe("when the reconcile runs as a dry run", () => {
      it("claims and releases nothing, counting what it would", async () => {
        const { service, claimed, released } = await setup();

        const outcome = await service.reconcile({ dryRun: true });

        expect(claimed).toEqual([]);
        expect(released).toEqual([]);
        expect(outcome).toEqual({ claimed: 3, skipped: 0, released: 4, kept: 1 });
      });
    });

    describe("when the reconcile runs a second time over the state the first left", () => {
      it("claims and releases nothing", async () => {
        const triggers = MemoryTriggerRepository.create(MemoryAutomationStore.create());
        await slackTrigger({ triggers, id: "active", connectionId: "c1" });
        const claims = [claimOf({ connectionId: "c1", claimantId: "stale" })];
        const { slack, released } = slackOver(claims);
        const claimed: string[] = [];
        const service = AutomationSlackClaimReconcileService.create({
          slack: Object.assign(slack, {
            releaseConnection: ({ claimantId }: { claimantId: string }) => {
              claims.splice(0, claims.length, ...claims.filter((c) => c.claimant.id !== claimantId));
              released.push(claimantId);
              return Promise.resolve();
            },
          }),
          triggers,
          slackConnections: {
            updateConnectionClaim: ({ trigger }) => {
              claimed.push(trigger.id);
              claims.push({
                connectionId: "c1",
                projectId: PROJECT,
                claimant: { id: trigger.id, label: trigger.name },
              });
              return Promise.resolve();
            },
          },
        });

        const first = await service.reconcile({ dryRun: false });
        const second = await service.reconcile({ dryRun: false });

        expect(first).toMatchObject({ claimed: 1, released: 1 });
        expect(second).toEqual({ claimed: 0, skipped: 0, released: 0, kept: 1 });
        expect(claimed).toEqual(["active"]);
        expect(released).toEqual(["stale"]);
      });
    });
  });
});
