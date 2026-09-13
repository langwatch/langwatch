// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The OpenAI compliance reference puller. The S3 transport is stubbed; what is
 * under test is the locked mapping: who the audit row says acted, and what of
 * the provider's line survives into the record.
 *
 * Every compliance line carries the person's id AND their email. The id is
 * the actor; the address must reach neither the event nor the audit row, and
 * a verbatim copy of the line would carry it there by the back door.
 *
 * Spec: specs/ai-governance/puller-framework/s3-polling.feature
 */
import { Readable } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({
  objects: [] as { key: string; body: string }[],
}));

vi.mock("@aws-sdk/client-s3", () => {
  class ListObjectsV2Command {
    constructor(readonly input: { Prefix?: string; StartAfter?: string }) {}
  }
  class GetObjectCommand {
    constructor(readonly input: { Bucket: string; Key: string }) {}
  }
  class S3Client {
    async send(cmd: ListObjectsV2Command | GetObjectCommand) {
      if (cmd instanceof ListObjectsV2Command) {
        return {
          Contents: stub.objects.map((o) => ({ Key: o.key })),
          IsTruncated: false,
        };
      }
      const found = stub.objects.find((o) => o.key === cmd.input.Key);
      if (!found) throw new Error(`stub: missing ${cmd.input.Key}`);
      return { Body: Readable.from([Buffer.from(found.body, "utf-8")]) };
    }
  }
  return { S3Client, ListObjectsV2Command, GetObjectCommand };
});

import { mapToOcsfRow } from "../ocsfPullEventMapping";
import { OpenAiComplianceReferencePuller } from "../openaiCompliance.puller";

const PERSON_ID = "u_123";
const PERSON_EMAIL = "person@acme.example";

/** One line in the shape OpenAI documents for its compliance export. */
const COMPLIANCE_LINE = {
  id: "evt-1",
  object: "audit_log",
  type: "completion",
  user: { id: PERSON_ID, email: PERSON_EMAIL },
  model: "gpt-5-mini",
  created_at: "2026-09-01T10:00:00Z",
  tokens: { input: 50, output: 12 },
  cost: { usd: 0.0023 },
};

const ADMIN_INPUT = {
  bucket: "acme-audit",
  prefix: "openai/compliance/",
  region: "us-east-1",
};

async function pullOneLine() {
  stub.objects = [
    {
      key: "openai/compliance/2026-09-01-10.ndjson",
      body: JSON.stringify(COMPLIANCE_LINE),
    },
  ];
  const puller = new OpenAiComplianceReferencePuller();
  const config = puller.validateConfig(ADMIN_INPUT);
  const result = await puller.runOnce(
    { cursor: null, credentials: {} },
    config,
  );
  // A precondition of every test below, not an assertion of any of them: a
  // line that failed to parse would make each test fail on a missing event.
  if (result.errorCount !== 0 || result.events.length !== 1) {
    throw new Error(
      `expected one clean event, got ${result.events.length} with ${result.errorCount} error(s)`,
    );
  }
  return result.events[0]!;
}

beforeEach(() => {
  stub.objects = [];
});

describe("given an OpenAI compliance line that carries both the person's id and their email", () => {
  describe("when the puller reads the line", () => {
    /** @scenario "An OpenAI compliance event names the person by their provider id, never by email" */
    it("names the person by their provider id", async () => {
      const event = await pullOneLine();

      expect(event.actor).toBe(PERSON_ID);
    });

    /** @scenario "An OpenAI compliance event names the person by their provider id, never by email" */
    it("lets the email reach nowhere in the emitted record", async () => {
      const event = await pullOneLine();

      expect(JSON.stringify(event)).not.toContain(PERSON_EMAIL);
    });

    /** @scenario "An OpenAI compliance event keeps no raw copy of what the provider sent" */
    it("keeps no verbatim copy of the provider's line", async () => {
      const event = await pullOneLine();

      expect(event.raw_payload).toBe("");
    });
  });

  describe("when the worker maps it to an audit row", () => {
    /** @scenario "An OpenAI compliance event keeps no raw copy of what the provider sent" */
    it("carries no raw copy and no email into the audit row", async () => {
      const event = await pullOneLine();

      const row = mapToOcsfRow({
        event,
        tenantId: "gov-proj-1",
        ingestionSourceId: "src-1",
        sourceType: "openai_compliance",
      });
      const extension = (
        JSON.parse(row.rawOcsfJson) as {
          metadata: { extension: Record<string, unknown> };
        }
      ).metadata.extension;

      expect(row.actorUserId).toBe(PERSON_ID);
      expect(row.actorEmail).toBe("");
      expect(extension.raw_event ?? "").toBe("");
      expect(JSON.stringify(row)).not.toContain(PERSON_EMAIL);
      // The line's own marker: if any verbatim copy survived, this is in it.
      expect(JSON.stringify(row)).not.toContain('"object":"audit_log"');
    });
  });
});
