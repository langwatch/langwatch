import { describe, expect, it } from "vitest";

import { MemorySlackConnectionRepository } from "../../repositories/memory/memory.slack-connection.repository.ts";
import { slackSecretFingerprint } from "../../rules/slack-secret-fingerprint.rules.ts";
import { MANAGER, ORG, OTHER_PROJECT, PROJECT, composeSlack } from "./slack-connection.fixture.ts";

/** Spec: specs/self-hosting/credentials-secret-rotation.feature */
const OLD_KEY = "a".repeat(64);
const NEW_KEY = "b".repeat(64);
const WEBHOOK = "https://hooks.slack.com/services/T/B/wxyz";
const OTHER_WEBHOOK = "https://hooks.slack.com/services/T/B/other";

const projectWebhook = {
  projectId: PROJECT,
  actorId: MANAGER,
  name: "Alerts",
  kind: "INCOMING_WEBHOOK",
  scopeType: "PROJECT",
  scopeId: PROJECT,
  secret: WEBHOOK,
} as const;
const lookup = {
  organizationId: ORG,
  projectId: PROJECT,
  kind: "INCOMING_WEBHOOK",
  secret: WEBHOOK,
  actorId: MANAGER,
} as const;

/** One table, read by a process before the rotation and by others after it. */
async function rotated() {
  const connections = MemorySlackConnectionRepository.create();
  const before = composeSlack({ connections, fingerprintKey: OLD_KEY });
  const existing = await before.service.createSlackConnection(projectWebhook);
  const during = composeSlack({
    connections,
    fingerprintKey: NEW_KEY,
    previousFingerprintKey: OLD_KEY,
  });
  const afterRemoval = composeSlack({ connections, fingerprintKey: NEW_KEY });
  const storedFingerprint = async (id: string) =>
    (await connections.findById({ id }))[0]?.secretFingerprint;
  return {
    existing,
    storedFingerprint,
    during: during.service,
    afterRemoval: afterRemoval.service,
  };
}

const underOldKey = slackSecretFingerprint({ secret: WEBHOOK, key: OLD_KEY });
const underNewKey = slackSecretFingerprint({ secret: WEBHOOK, key: NEW_KEY });

describe("SlackConnectionService across a CREDENTIALS_SECRET rotation", () => {
  describe("given a Slack secret connected under the old secret", () => {
    describe("when the previous secret is set and the same Slack secret is saved again", () => {
      /** @scenario "A Slack secret connected before the rotation is recognised and moves to the new secret" */
      it("answers the existing connection and restamps its fingerprint under the new secret", async () => {
        const { existing, during, afterRemoval, storedFingerprint } = await rotated();
        expect(await storedFingerprint(existing.id)).toBe(underOldKey);

        const found = await during.findOrCreateSlackConnectionForSecret(lookup);

        expect(found).toEqual({ id: existing.id, wasCreated: false });
        expect(await storedFingerprint(existing.id)).toBe(underNewKey);
        await expect(afterRemoval.findOrCreateSlackConnectionForSecret(lookup)).resolves.toEqual({
          id: existing.id,
          wasCreated: false,
        });
      });

      /** @scenario "Connecting a Slack secret already connected before the rotation is refused" */
      it("refuses a second connection for the secret, naming the existing one", async () => {
        const { existing, during, storedFingerprint } = await rotated();

        await expect(
          during.createSlackConnection({ ...projectWebhook, name: "Again" }),
        ).rejects.toMatchObject({
          code: "slack_connection_exists",
          meta: { connectionId: existing.id, connectionName: "Alerts" },
        });
        expect(await storedFingerprint(existing.id)).toBe(underNewKey);
      });

      /** @scenario "Replacing a Slack connection's secret with one connected before the rotation is refused" */
      it("refuses an edit that would give another connection the same secret", async () => {
        const { existing, during } = await rotated();
        const other = await during.createSlackConnection({
          ...projectWebhook,
          name: "Other",
          secret: OTHER_WEBHOOK,
        });

        await expect(
          during.updateSlackConnection({
            projectId: PROJECT,
            actorId: MANAGER,
            id: other.id,
            secret: WEBHOOK,
          }),
        ).rejects.toMatchObject({
          code: "slack_connection_exists",
          meta: { connectionId: existing.id },
        });
      });

      /** @scenario "Moving a Slack connection made before the rotation into a scope holding its secret is refused" */
      it("refuses the move, though the two fingerprints were stored under different secrets", async () => {
        const { existing, during } = await rotated();
        const elsewhere = await during.createSlackConnection({
          ...projectWebhook,
          projectId: OTHER_PROJECT,
          scopeId: OTHER_PROJECT,
        });
        const organizationWide = await during.updateSlackConnection({
          projectId: OTHER_PROJECT,
          actorId: MANAGER,
          id: elsewhere.id,
          scopeType: "ORGANIZATION",
        });

        await expect(
          during.updateSlackConnection({
            projectId: PROJECT,
            actorId: MANAGER,
            id: existing.id,
            scopeType: "ORGANIZATION",
          }),
        ).rejects.toMatchObject({
          code: "slack_connection_exists",
          meta: { connectionId: organizationWide.id },
        });
      });
    });

    describe("when a new Slack secret is connected during the rotation", () => {
      /** @scenario "A Slack secret connected after the rotation is fingerprinted under the new secret alone" */
      it("stores the fingerprint under the new secret, never the previous one", async () => {
        const { during, storedFingerprint } = await rotated();

        const created = await during.createSlackConnection({
          ...projectWebhook,
          name: "Other",
          secret: OTHER_WEBHOOK,
        });

        expect(await storedFingerprint(created.id)).toBe(
          slackSecretFingerprint({ secret: OTHER_WEBHOOK, key: NEW_KEY }),
        );
      });
    });

    describe("when the previous secret was removed before the secret was seen again", () => {
      /** @scenario "A Slack secret never seen during the rotation is not recognised once the previous secret is removed" */
      it("creates a second connection, the old fingerprint left as it was", async () => {
        const { existing, afterRemoval, storedFingerprint } = await rotated();

        const found = await afterRemoval.findOrCreateSlackConnectionForSecret(lookup);

        expect(found.wasCreated).toBe(true);
        expect(found.id).not.toBe(existing.id);
        expect(await storedFingerprint(existing.id)).toBe(underOldKey);
      });
    });
  });
});
