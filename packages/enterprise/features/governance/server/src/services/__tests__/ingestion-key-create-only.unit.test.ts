/**
 * The create-only branch of the ingestion-key mint, `issueForProject`.
 * Spec: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { describe, expect, it } from "vitest";

import {
  IngestionKeyIssuerPort,
  IngestionKeyRepository,
  type StoredIngestionKey,
} from "../../ports/ingestion-source-key.port";
import { TestOrganizationService } from "../../ports/__tests__/support/test-organization-service";
import { IngestionKeyService } from "../ingestion-source-key.service";

const ORGANIZATION_ID = "org-1";
const PROJECT_ID = "project-checkout-api";
const SOURCE_TYPE = "claude_code";

/** The organization's live keys, as the two collaborators see them. */
class KeyLedger {
  private nextId = 0;
  readonly keys = new Map<string, { live: boolean; sourceType: string; projectId: string }>();

  issue(input: { projectId: string; sourceType: string }): string {
    const id = `key-${++this.nextId}`;
    this.keys.set(id, { live: true, ...input });
    return id;
  }

  revoke(id: string): void {
    const key = this.keys.get(id);
    if (key) key.live = false;
  }

  isLive(id: string): boolean {
    return this.keys.get(id)?.live === true;
  }

  tryFindLive(input: { projectId: string; sourceType: string }): string | null {
    for (const [id, key] of this.keys) {
      if (key.live && key.projectId === input.projectId && key.sourceType === input.sourceType) {
        return id;
      }
    }
    return null;
  }
}

class LedgerRepository extends IngestionKeyRepository {
  constructor(private readonly ledger: KeyLedger) {
    super();
  }

  tryFindIngestKey(input: {
    organizationId: string;
    projectId: string;
    sourceType: string;
  }): Promise<StoredIngestionKey | null> {
    const id = this.ledger.tryFindLive(input);
    return Promise.resolve(
      id
        ? {
            id,
            lookupId: `lookup-${id}`,
            ingestSourceType: input.sourceType,
            ingestionTemplateId: null,
          }
        : null,
    );
  }

  findIngestKeysForProject(): Promise<StoredIngestionKey[]> {
    return Promise.resolve([]);
  }
}

class LedgerIssuer extends IngestionKeyIssuerPort {
  constructor(private readonly ledger: KeyLedger) {
    super();
  }

  create(input: {
    ingestSourceType: string;
    bindings: readonly [{ scopeId: string }];
  }): Promise<{ token: string; apiKey: { id: string } }> {
    const id = this.ledger.issue({
      projectId: input.bindings[0].scopeId,
      sourceType: input.ingestSourceType,
    });
    return Promise.resolve({ token: `ik-lw-${id}-token`, apiKey: { id } });
  }

  revoke(input: { id: string }): Promise<void> {
    this.ledger.revoke(input.id);
    return Promise.resolve();
  }
}

describe("given a machine already holds an ingestion key for a project and tool", () => {
  describe("when a second machine mints for the same project and source type", () => {
    /** @scenario "Two machines each keep a live key for the same project and tool" */
    it("leaves both keys live, unlike the rotating personal branch", async () => {
      const ledger = new KeyLedger();
      const service = IngestionKeyService.create({
        repository: new LedgerRepository(ledger),
        issuer: new LedgerIssuer(ledger),
        organizations: new TestOrganizationService(),
      });
      const mint = (deviceLabel: string) =>
        service.issueForProject({
          callerUserId: "user-1",
          ownerUserId: null,
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          sourceType: SOURCE_TYPE,
          createdByDeviceLabel: deviceLabel,
        });

      const first = await mint("laptop-a");
      const second = await mint("laptop-b");

      expect(second.token).not.toBe(first.token);
      expect(ledger.isLive(first.apiKeyId)).toBe(true);
      expect(ledger.isLive(second.apiKeyId)).toBe(true);
    });
  });

  describe("when the rotating branch mints for the same project and source type", () => {
    it("revokes the prior key, which is the behaviour the CLI branch avoids", async () => {
      const ledger = new KeyLedger();
      const service = IngestionKeyService.create({
        repository: new LedgerRepository(ledger),
        issuer: new LedgerIssuer(ledger),
        organizations: new TestOrganizationService(),
      });
      const rotate = () =>
        service.ensureForProject({
          callerUserId: "user-1",
          ownerUserId: "user-1",
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          sourceType: SOURCE_TYPE,
        });

      const first = await rotate();
      const second = await rotate();

      expect(ledger.isLive(first.apiKeyId)).toBe(false);
      expect(ledger.isLive(second.apiKeyId)).toBe(true);
    });
  });
});
