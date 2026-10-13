import { describe, expect, it } from "vitest";

import { MANAGER, ORG, OTHER_PROJECT, PROJECT, composeSlack } from "./slack-connection.fixture.ts";

/** Spec: modules/slack/specs/slack-connections.feature */
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

  describe("when the claims are read a page at a time", () => {
    /** @scenario A page of claims returns each one with its connection, project and claimant */
    it("returns every organisation's claims with their claimants, ordered by claim id", async () => {
      const { claims, repositories, connection } = await connected();
      await claims.claimConnection({
        connectionId: connection.id,
        projectId: PROJECT,
        claimant: { id: "t2", label: "Second" },
      });
      await claims.claimConnection({
        connectionId: connection.id,
        projectId: PROJECT,
        claimant: { id: "t1", label: "First" },
      });
      await repositories.claims.upsert({
        connectionId: "~elsewhere",
        claimantId: "t9",
        claimantLabel: "Theirs",
        organizationId: "org_other",
        projectId: "project_other",
      });

      const page = await claims.listSlackConnectionClaims({});

      expect(page).toEqual({
        claims: [
          {
            connectionId: connection.id,
            projectId: PROJECT,
            claimant: { id: "t1", label: "First" },
          },
          {
            connectionId: connection.id,
            projectId: PROJECT,
            claimant: { id: "t2", label: "Second" },
          },
          {
            connectionId: "~elsewhere",
            projectId: "project_other",
            claimant: { id: "t9", label: "Theirs" },
          },
        ],
        next: null,
      });
    });

    /** @scenario The next page resumes after the cursor the last page handed out */
    it("reads every claim exactly once across pages and ends without a cursor", async () => {
      const { claims, repositories } = await connected();
      const ids = ["a", "b", "c", "d", "e"];
      for (const id of ids) {
        await repositories.claims.upsert({
          connectionId: `connection-${id}`,
          claimantId: `trigger-${id}`,
          claimantLabel: id,
          organizationId: ORG,
          projectId: PROJECT,
        });
      }

      const read: string[] = [];
      const cursors: (string | null)[] = [];
      let after: string | undefined;
      do {
        const page = await claims.listSlackConnectionClaims({ after, limit: 2 });
        read.push(...page.claims.map((claim) => claim.claimant.id));
        cursors.push(page.next);
        after = page.next ?? undefined;
      } while (after);

      expect(read).toEqual(ids.map((id) => `trigger-${id}`));
      expect(cursors.at(-1)).toBeNull();
    });

    /** @scenario With no claims the page is empty and hands out no cursor */
    it("answers an empty page with no cursor when nothing is claimed", async () => {
      const { claims } = await connected();

      await expect(claims.listSlackConnectionClaims({})).resolves.toEqual({
        claims: [],
        next: null,
      });
    });

    /** @scenario A paged claim the claimant releases is no longer listed */
    it("stops listing a claim once its claimant releases it", async () => {
      const { claims, connection } = await connected();
      await claims.claimConnection({
        connectionId: connection.id,
        projectId: PROJECT,
        claimant: { id: "t1", label: "Alert" },
      });
      const {
        claims: [listed],
      } = await claims.listSlackConnectionClaims({});

      await claims.releaseConnection({
        connectionId: listed!.connectionId,
        projectId: listed!.projectId,
        claimantId: listed!.claimant.id,
      });

      await expect(claims.listSlackConnectionClaims({})).resolves.toEqual({
        claims: [],
        next: null,
      });
    });

    /** @scenario A cursor no page handed out is refused */
    it("fails on a cursor no page handed out", async () => {
      const { claims } = await connected();

      await expect(claims.listSlackConnectionClaims({ after: "not-a-cursor" })).rejects.toThrow(
        "The claim page cursor was not handed out by a page.",
      );
    });
  });
});
