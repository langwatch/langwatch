// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The personal-workspace mint: one key per device, capped per tool.
 *
 * A person runs the same tool from several machines under one login, so the
 * personal mint creates rather than rotates. The cap is what keeps that list
 * bounded, and it retires the key that has gone unused the longest — the
 * machine most likely gone.
 *
 * Spec: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import {
  PERSONAL_INGEST_KEYS_PER_TOOL_CAP,
  PersonalSourceTypeNotAllowedError,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import {
  IngestionKeyIssuerPort,
  IngestionKeyRepository,
  type StoredIngestionKey,
  type StoredIngestionKeyOwnership,
} from "../../ports/ingestion-source-key.port.ts";
import type { OrganizationService } from "@langwatch/organization-contract";
import { IngestionKeyService } from "../ingestion-source-key.service.ts";

const ORGANIZATION_ID = "org-1";
const PROJECT_ID = "project-personal";
const USER_ID = "user-1";

type Row = {
  id: string;
  lookupId: string;
  organizationId: string;
  userId: string | null;
  ingestSourceType: string | null;
  ingestionTemplateId: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
  revocationCause: string | null;
};

/** The personal workspace's keys, as the two collaborators see them. */
class KeyLedger {
  private nextId = 0;
  readonly rows: Row[] = [];
  /** Ids whose revoke throws, standing in for a key another device just killed. */
  readonly unrevokable = new Set<string>();
  readonly revokedWith: Array<{ id: string; cause: string | undefined }> = [];

  issue(input: { sourceType: string }): Row {
    this.nextId += 1;
    const row: Row = {
      id: `key-${this.nextId}`,
      lookupId: `lookup-${this.nextId}`,
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      ingestSourceType: input.sourceType,
      ingestionTemplateId: null,
      lastUsedAt: null,
      createdAt: new Date(1_700_000_000_000 + this.nextId),
      revokedAt: null,
      revocationCause: null,
    };
    this.rows.push(row);
    return row;
  }

  revoke(input: { id: string; cause?: string }): void {
    this.revokedWith.push({ id: input.id, cause: input.cause });
    if (this.unrevokable.has(input.id)) throw new Error("already revoked");
    const row = this.rows.find((candidate) => candidate.id === input.id);
    if (row && !row.revokedAt) {
      row.revokedAt = new Date();
      row.revocationCause = input.cause ?? "user";
    }
  }

  live(sourceType: string): Row[] {
    return this.rows.filter((row) => !row.revokedAt && row.ingestSourceType === sourceType);
  }
}

class LedgerRepository extends IngestionKeyRepository {
  constructor(private readonly ledger: KeyLedger) {
    super();
  }

  tryFindIngestKey(): Promise<StoredIngestionKey | null> {
    return Promise.resolve(null);
  }

  findIngestKeysForProject(): Promise<StoredIngestionKey[]> {
    return Promise.resolve(this.ledger.rows.filter((row) => !row.revokedAt));
  }

  tryFindByLookupId(input: { lookupId: string }): Promise<StoredIngestionKeyOwnership | null> {
    return Promise.resolve(this.ledger.rows.find((row) => row.lookupId === input.lookupId) ?? null);
  }
}

class LedgerIssuer extends IngestionKeyIssuerPort {
  constructor(private readonly ledger: KeyLedger) {
    super();
  }

  create(input: { ingestSourceType: string }): Promise<{ token: string; apiKey: { id: string } }> {
    const row = this.ledger.issue({ sourceType: input.ingestSourceType });
    return Promise.resolve({
      token: `ik-lw-${row.lookupId}_secret`,
      apiKey: { id: row.id },
    });
  }

  revoke(input: { id: string; cause?: string }): Promise<void> {
    this.ledger.revoke(input);
    return Promise.resolve();
  }
}

function serviceOver(ledger: KeyLedger) {
  return IngestionKeyService.create({
    repository: new LedgerRepository(ledger),
    issuer: new LedgerIssuer(ledger),
    organizations: {
      tryFindPersonalWorkspace: async () => ({ project: { id: PROJECT_ID } }),
    } as unknown as OrganizationService,
  });
}

const mint = (ledger: KeyLedger, sourceType: string) =>
  serviceOver(ledger).issueForPersonalProject({
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    sourceType,
  });

describe("given a device that already minted a personal key for a tool", () => {
  describe("when a second device mints for the same tool", () => {
    /** @scenario "Two devices each keep a live personal key for the same tool" */
    it("leaves both keys live", async () => {
      const ledger = new KeyLedger();

      const laptop = await mint(ledger, "claude_code");
      const desktop = await mint(ledger, "claude_code");

      expect(desktop.token).not.toBe(laptop.token);
      expect(ledger.live("claude_code").map((row) => row.id)).toEqual([
        laptop.apiKeyId,
        desktop.apiKeyId,
      ]);
    });
  });
});

describe("given a workspace holding the cap of live keys for a tool", () => {
  /** Fills the cap and marks the third key as the one used least recently. */
  async function atCap(): Promise<{ ledger: KeyLedger; idle: Row }> {
    const ledger = new KeyLedger();
    for (let index = 0; index < PERSONAL_INGEST_KEYS_PER_TOOL_CAP; index += 1) {
      await mint(ledger, "claude_code");
    }
    const live = ledger.live("claude_code");
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    for (const [index, row] of live.entries()) {
      row.lastUsedAt = index === 2 ? monthAgo : new Date();
    }
    return { ledger, idle: live[2]! };
  }

  describe("when another device mints for the same tool", () => {
    /** @scenario "Personal keys per tool are capped, least recently used first" */
    it("revokes the key used least recently and keeps the count at the cap", async () => {
      const { ledger, idle } = await atCap();

      const fresh = await mint(ledger, "claude_code");

      const live = ledger.live("claude_code");
      expect(live).toHaveLength(PERSONAL_INGEST_KEYS_PER_TOOL_CAP);
      expect(live.map((row) => row.id)).not.toContain(idle.id);
      expect(live.map((row) => row.id)).toContain(fresh.apiKeyId);
    });

    /** @scenario "The cap names itself as the cause of the keys it retires" */
    it("records the cap as the cause", async () => {
      const { ledger, idle } = await atCap();

      await mint(ledger, "claude_code");

      expect(ledger.rows.find((row) => row.id === idle.id)?.revocationCause).toBe("cap");
    });

    /** @scenario "An eviction that fails does not fail the mint" */
    it("still returns the new key when a retirement fails, and retires the rest", async () => {
      const { ledger, idle } = await atCap();
      // One key over the cap, the way a race between two devices leaves it, so
      // this mint has two to retire and one of them refuses.
      const alsoIdle = ledger.issue({ sourceType: "claude_code" });
      alsoIdle.lastUsedAt = new Date(1);
      idle.lastUsedAt = new Date(0);
      ledger.unrevokable.add(idle.id);

      const fresh = await mint(ledger, "claude_code");

      expect(fresh.token).toContain("ik-lw-");
      expect(ledger.revokedWith.map((call) => call.id)).toContain(idle.id);
      expect(ledger.rows.find((row) => row.id === idle.id)?.revokedAt).toBeNull();
      expect(ledger.rows.find((row) => row.id === alsoIdle.id)?.revocationCause).toBe("cap");
      expect(ledger.live("claude_code").map((row) => row.id)).toContain(fresh.apiKeyId);
    });
  });

  describe("when a device mints for a different tool", () => {
    /** @scenario "The cap counts one tool at a time" */
    it("revokes no key of the full tool", async () => {
      const { ledger } = await atCap();
      const before = ledger.live("claude_code").map((row) => row.id);

      await mint(ledger, "codex");

      expect(ledger.live("claude_code").map((row) => row.id)).toEqual(before);
    });
  });
});

describe("given a source type no wrapped tool stamps", () => {
  describe("when the CLI asks for a personal key", () => {
    /** @scenario "A personal key is minted only for a tool the CLI wraps" */
    it("refuses and mints nothing", async () => {
      const ledger = new KeyLedger();

      await expect(mint(ledger, "made_up")).rejects.toBeInstanceOf(
        PersonalSourceTypeNotAllowedError,
      );
      await expect(mint(ledger, "toString")).rejects.toBeInstanceOf(
        PersonalSourceTypeNotAllowedError,
      );
      expect(ledger.rows).toHaveLength(0);
    });
  });
});

describe("given keys the person and the platform each revoked", () => {
  describe("when the CLI asks what became of a lookup id", () => {
    /** @scenario "The CLI can ask what became of its own key" */
    it("answers with the cause, live for a live key, and unknown for a stranger's", async () => {
      const ledger = new KeyLedger();
      const service = serviceOver(ledger);
      const byPerson = await mint(ledger, "opencode");
      const byCap = await mint(ledger, "opencode");
      const live = await mint(ledger, "opencode");
      ledger.revoke({ id: byPerson.apiKeyId });
      ledger.revoke({ id: byCap.apiKeyId, cause: "cap" });

      const describe_ = (lookupId: string) =>
        service.tryDescribePersonalKey({
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          lookupId,
        });

      expect(await describe_(`lookup-1`)).toMatchObject({
        live: false,
        revocationCause: "user",
      });
      expect(await describe_(`lookup-2`)).toMatchObject({
        live: false,
        revocationCause: "cap",
      });
      expect(await describe_(`lookup-3`)).toMatchObject({
        live: true,
        revocationCause: null,
      });
      expect(live.apiKeyId).toBe("key-3");
      expect(await describe_("nosuchlookupid")).toBeNull();
    });
  });
});
