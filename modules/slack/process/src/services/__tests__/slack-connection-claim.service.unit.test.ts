import { describe, expect, it } from "vitest";

import { MANAGER, OTHER_PROJECT, PROJECT, composeSlack } from "./slack-connection.fixture.ts";

/** Spec: specs/automations/slack-connections.feature */
const WEBHOOK = "https://hooks.slack.com/services/T/B/wxyz";

async function connected() {
  const slack = composeSlack();
  const connection = await slack.service.createSlackConnection({
    projectId: PROJECT,
    actorId: MANAGER,
    name: "Alerts",
    kind: "INCOMING_WEBHOOK",
    scopeType: "PROJECT",
    scopeId: PROJECT,
    secret: WEBHOOK,
  });
  return { ...slack, connection };
}

describe("SlackConnectionClaimService", () => {
  /** @scenario Saving an automation on a connection claims it */
  it("claims idempotently, refreshing the label", async () => {
    const { claims, service, connection } = await connected();
    await claims.claimConnection({
      connectionId: connection.id,
      projectId: PROJECT,
      claimant: { id: "t1", label: "Old" },
    });
    await claims.claimConnection({
      connectionId: connection.id,
      projectId: PROJECT,
      claimant: { id: "t1", label: "New" },
    });
    await expect(
      service.deleteSlackConnection({ projectId: PROJECT, actorId: MANAGER, id: connection.id }),
    ).rejects.toMatchObject({
      code: "slack_connection_in_use",
      meta: { dependentAutomations: 1, claimants: [{ id: "t1", label: "New" }] },
    });
  });

  it("refuses a claim on a connection the claimant's project cannot use", async () => {
    const { claims, connection } = await connected();
    await expect(
      claims.claimConnection({
        connectionId: connection.id,
        projectId: OTHER_PROJECT,
        claimant: { id: "t1", label: "x" },
      }),
    ).rejects.toMatchObject({ code: "slack_integration_missing" });
  });

  /** @scenario Pausing or deleting an automation releases its connection */
  it("releases idempotently", async () => {
    const { claims, connection } = await connected();
    await claims.releaseConnection({
      connectionId: connection.id,
      projectId: PROJECT,
      claimantId: "never-claimed",
    });
    await expect(
      claims.releaseConnection({
        connectionId: connection.id,
        projectId: PROJECT,
        claimantId: "never-claimed",
      }),
    ).resolves.toBeUndefined();
  });
});
