import { describe, expect, it } from "vitest";

import {
  MANAGER,
  ORG,
  OTHER_PROJECT,
  PROJECT,
  VIEWER,
  composeSlack,
} from "./slack-connection.fixture.ts";

/** Spec: specs/automations/slack-connections.feature */
const BOT = "xoxb-1111-secret-abcd";
const WEBHOOK = "https://hooks.slack.com/services/T/B/wxyz";
const team = { teamId: "T1", teamName: "Acme Slack" };

function composeWithBot() {
  const slack = composeSlack();
  slack.webApi.accept({ token: BOT, identity: team });
  return slack;
}

const orgBot = {
  projectId: PROJECT,
  actorId: MANAGER,
  name: "Ops",
  kind: "BOT",
  scopeType: "ORGANIZATION",
  scopeId: ORG,
  secret: BOT,
} as const;
const projectWebhook = {
  projectId: PROJECT,
  actorId: MANAGER,
  name: "Alerts",
  kind: "INCOMING_WEBHOOK",
  scopeType: "PROJECT",
  scopeId: PROJECT,
  secret: WEBHOOK,
} as const;

describe("SlackConnectionService", () => {
  /** @scenario Adding a bot connection for the organization */
  it("stores a bot connection Slack accepted, with its workspace and a hint only", async () => {
    const { service, repositories } = composeWithBot();
    const created = await service.createSlackConnection(orgBot);
    expect(created).toMatchObject({
      scopeType: "ORGANIZATION",
      scopeName: "Acme",
      secretHint: "abcd",
      slackTeamName: "Acme Slack",
      canManage: true,
    });
    expect(created.id.startsWith("slackintegration")).toBe(true);
    const [row] = await repositories.connections.findById({ id: created.id });
    expect(JSON.stringify(row)).not.toContain(BOT);
  });

  /** @scenario Adding a webhook connection for one project */
  it("stores a webhook connection for one project without asking Slack", async () => {
    const { service, webApi } = composeSlack();
    const created = await service.createSlackConnection(projectWebhook);
    expect(created).toMatchObject({
      kind: "INCOMING_WEBHOOK",
      scopeName: "Alpha",
      secretHint: "wxyz",
    });
    expect(webApi.checked).toEqual([]);
  });

  /** @scenario A project lists its own connections and its organization's */
  it("lists the project's and the organization's connections, never another project's", async () => {
    const { service } = composeWithBot();
    await service.createSlackConnection(orgBot);
    await service.createSlackConnection(projectWebhook);
    await service.createSlackConnection({
      ...projectWebhook,
      projectId: OTHER_PROJECT,
      scopeId: OTHER_PROJECT,
      secret: `${WEBHOOK}2`,
    });
    const list = await service.listSlackConnections({ projectId: PROJECT, actorId: MANAGER });
    expect(list.connections.map((each) => each.name)).toEqual(["Alerts", "Ops"]);
    expect(list).toMatchObject({ canManageProject: true, canManageOrganization: true });
  });

  it("lists nothing as manageable without an actor", async () => {
    const { service } = composeSlack();
    await service.createSlackConnection(projectWebhook);
    const list = await service.listSlackConnections({ projectId: PROJECT });
    expect(list.connections[0]?.canManage).toBe(false);
  });

  /** @scenario A token Slack rejects is refused at setup */
  it("refuses a bot token Slack rejects and stores nothing", async () => {
    const { service } = composeSlack();
    await expect(service.createSlackConnection(orgBot)).rejects.toMatchObject({
      code: "slack_integration_invalid_token",
    });
    expect((await service.listSlackConnections({ projectId: PROJECT })).connections).toEqual([]);
  });

  /** @scenario The same secret cannot be stored twice in one scope */
  it("refuses the same secret twice in one scope, naming the existing connection", async () => {
    const { service } = composeSlack();
    const first = await service.createSlackConnection(projectWebhook);
    await expect(
      service.createSlackConnection({ ...projectWebhook, name: "Again" }),
    ).rejects.toMatchObject({
      code: "slack_connection_exists",
      meta: { connectionId: first.id, connectionName: "Alerts" },
    });
  });

  /** @scenario A project connection is refused when its organization already holds the secret */
  it("refuses a project copy of a secret its organization holds", async () => {
    const { service } = composeWithBot();
    await service.createSlackConnection(orgBot);
    await expect(
      service.createSlackConnection({ ...orgBot, scopeType: "PROJECT", scopeId: PROJECT }),
    ).rejects.toMatchObject({ code: "slack_connection_exists" });
  });

  /** @scenario A secret only another project holds can still be stored for this project */
  it("stores a secret another project holds as this project's own", async () => {
    const { service } = composeSlack();
    await service.createSlackConnection({
      ...projectWebhook,
      projectId: OTHER_PROJECT,
      scopeId: OTHER_PROJECT,
    });
    await expect(service.createSlackConnection(projectWebhook)).resolves.toMatchObject({
      scopeId: PROJECT,
    });
  });

  /** @scenario Scope decides who may change a connection */
  it("refuses a caller without the scope's manage permission", async () => {
    const { service } = composeWithBot();
    await expect(
      service.createSlackConnection({ ...orgBot, actorId: VIEWER }),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("refuses a scope that is neither this project nor its organization", async () => {
    const { service } = composeSlack();
    await expect(
      service.createSlackConnection({ ...projectWebhook, scopeId: OTHER_PROJECT }),
    ).rejects.toMatchObject({ code: "invalid_action_params" });
  });

  /** @scenario Replacing a secret needs no automation edits */
  it("replaces a secret in place, keeping the id", async () => {
    const { service } = composeSlack();
    const created = await service.createSlackConnection(projectWebhook);
    const updated = await service.updateSlackConnection({
      projectId: PROJECT,
      actorId: MANAGER,
      id: created.id,
      secret: `${WEBHOOK}-new9`,
    });
    expect(updated).toMatchObject({ id: created.id, secretHint: "new9" });
  });

  /** @scenario Editing a connection without retyping its secret keeps the secret */
  it("renames without touching the stored secret", async () => {
    const { service } = composeSlack();
    const created = await service.createSlackConnection(projectWebhook);
    await service.updateSlackConnection({
      projectId: PROJECT,
      actorId: MANAGER,
      id: created.id,
      name: "Renamed",
    });
    expect(await service.findUsableSlackSecret({ id: created.id, projectId: PROJECT })).toEqual([
      { kind: "INCOMING_WEBHOOK", url: WEBHOOK },
    ]);
  });

  /** @scenario Deleting a connection in use is refused and names its automations */
  it("refuses deleting a claimed connection, naming the claimants, and keeps it", async () => {
    const { service, claims } = composeSlack();
    const created = await service.createSlackConnection(projectWebhook);
    await claims.claimConnection({
      connectionId: created.id,
      projectId: PROJECT,
      claimant: { id: "t1", label: "Errors to ops" },
    });
    await claims.claimConnection({
      connectionId: created.id,
      projectId: PROJECT,
      claimant: { id: "t2", label: "Daily digest" },
    });
    await expect(
      service.deleteSlackConnection({ projectId: PROJECT, actorId: MANAGER, id: created.id }),
    ).rejects.toMatchObject({
      code: "slack_connection_in_use",
      meta: {
        dependentAutomations: 2,
        claimants: [
          { id: "t1", label: "Errors to ops" },
          { id: "t2", label: "Daily digest" },
        ],
      },
    });
    await expect(
      service.getUsableSlackConnection({ id: created.id, projectId: PROJECT }),
    ).resolves.toMatchObject({ dependentAutomations: 2 });
  });

  /** @scenario A connection deletes once no automation uses it */
  it("deletes once the last claim is released", async () => {
    const { service, claims } = composeSlack();
    const created = await service.createSlackConnection(projectWebhook);
    await claims.claimConnection({
      connectionId: created.id,
      projectId: PROJECT,
      claimant: { id: "t1", label: "Errors to ops" },
    });
    await claims.releaseConnection({
      connectionId: created.id,
      projectId: PROJECT,
      claimantId: "t1",
    });
    await expect(
      service.deleteSlackConnection({ projectId: PROJECT, actorId: MANAGER, id: created.id }),
    ).resolves.toEqual({ deleted: true, dependentAutomations: 0 });
    await expect(
      service.getUsableSlackConnection({ id: created.id, projectId: PROJECT }),
    ).rejects.toMatchObject({ code: "slack_integration_missing" });
  });

  /** @scenario Narrowing an organization connection other projects use is confirmed first */
  it("refuses narrowing past other projects' claims until forced", async () => {
    const { service, claims } = composeWithBot();
    const created = await service.createSlackConnection(orgBot);
    for (const id of ["t1", "t2"]) {
      await claims.claimConnection({
        connectionId: created.id,
        projectId: OTHER_PROJECT,
        claimant: { id, label: id },
      });
    }
    const narrow = {
      projectId: PROJECT,
      actorId: MANAGER,
      id: created.id,
      scopeType: "PROJECT",
    } as const;
    await expect(service.updateSlackConnection(narrow)).rejects.toMatchObject({
      code: "slack_connection_in_use",
      meta: { dependentAutomations: 2 },
    });
    await expect(
      service.getUsableSlackConnection({ id: created.id, projectId: PROJECT }),
    ).resolves.toMatchObject({ scopeType: "ORGANIZATION" });
    await expect(service.updateSlackConnection({ ...narrow, force: true })).resolves.toMatchObject({
      scopeType: "PROJECT",
      scopeId: PROJECT,
    });
  });

  /** @scenario A legacy secret held only by another project creates a connection for this project */
  it("creates a project connection for a secret only another project holds", async () => {
    const { service } = composeSlack();
    const theirs = await service.createSlackConnection({
      ...projectWebhook,
      projectId: OTHER_PROJECT,
      scopeId: OTHER_PROJECT,
    });
    const ours = await service.findOrCreateSlackConnectionForSecret({
      organizationId: ORG,
      projectId: PROJECT,
      kind: "INCOMING_WEBHOOK",
      secret: WEBHOOK,
      actorId: MANAGER,
    });
    expect(ours).toMatchObject({ wasCreated: true });
    expect(ours.id).not.toBe(theirs.id);
  });

  /** @scenario A legacy secret this project can already use reuses that connection */
  it("reuses a connection the project can already use", async () => {
    const { service } = composeWithBot();
    const org = await service.createSlackConnection(orgBot);
    await expect(
      service.findOrCreateSlackConnectionForSecret({
        organizationId: ORG,
        projectId: PROJECT,
        kind: "BOT",
        secret: BOT,
        actorId: MANAGER,
      }),
    ).resolves.toEqual({ id: org.id, wasCreated: false });
  });

  /** @scenario A connection outside the automation's reach fails with a named cause */
  it("hands no secret to a project outside the connection's reach", async () => {
    const { service } = composeSlack();
    const created = await service.createSlackConnection(projectWebhook);
    expect(
      await service.findUsableSlackSecret({ id: created.id, projectId: OTHER_PROJECT }),
    ).toEqual([]);
    await expect(
      service.getUsableSlackConnection({ id: created.id, projectId: OTHER_PROJECT }),
    ).rejects.toMatchObject({ code: "slack_integration_missing" });
  });
});
