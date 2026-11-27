// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Test connection through the real SQS channel and AWS SDK: the subscriber role is assumed with
 * the external id LangWatch generated before the queue is read. Requests to AWS hosts are sent to
 * a local server, so the AssumeRole body and the SQS signature are read as sent.
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import http, { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";

import type {
  GovernanceIngestionSource,
  SecurityLakeSourceCreateInput,
} from "@langwatch/enterprise-governance-contract";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SqsSecurityLakeQueueChannel } from "../../../../channels/sqs/sqs.security-lake-queue.channel.ts";
import { MemoryOcsfEventsRepository } from "../../../../repositories/memory/memory.ocsf-events.repository.ts";
import { SecurityLakeSourceService } from "../security-lake-source.service.ts";

const ROLE_ARN = "arn:aws:iam::123456789012:role/AmazonSecurityLake-subscriber";
const TEMP_KEY = `ASIA${"TEMPORARYROLEKEY"}`;
const CALLER_EXTERNAL_ID = "caller-picked-id";
/** A caller's settings carrying an external id of its own, which the service must not store. */
const CONFIG_WITH_CALLER_EXTERNAL_ID: SecurityLakeSourceCreateInput["config"] = Object.assign(
  {
    region: "eu-west-1",
    subscriberRoleArn: ROLE_ARN,
    queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-subscriber",
    sources: ["CLOUD_TRAIL_MGMT" as const],
    maxMessagesPerRun: 100,
    maxReceives: 3,
    schedule: "*/5 * * * *",
  },
  { externalId: CALLER_EXTERNAL_ID },
);

type Captured = { host: string; headers: IncomingHttpHeaders; body: string };
const captured: Captured[] = [];
let server: Server;
let port: number;

const ASSUME_ROLE_XML = `<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
<AssumeRoleResult><Credentials><AccessKeyId>${TEMP_KEY}</AccessKeyId>
<SecretAccessKey>temporary-secret</SecretAccessKey><SessionToken>temporary-session</SessionToken>
<Expiration>2099-01-01T00:00:00Z</Expiration></Credentials>
<AssumedRoleUser><Arn>${ROLE_ARN}/langwatch</Arn><AssumedRoleId>AROA:langwatch</AssumedRoleId></AssumedRoleUser>
</AssumeRoleResult><ResponseMetadata><RequestId>req-1</RequestId></ResponseMetadata></AssumeRoleResponse>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const host = String(req.headers.host ?? "");
      captured.push({ host, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      if (host.startsWith("sts.")) {
        res.writeHead(200, { "content-type": "text/xml" });
        res.end(ASSUME_ROLE_XML);
        return;
      }
      res.writeHead(200, { "content-type": "application/x-amz-json-1.0" });
      res.end(
        JSON.stringify({
          Attributes: {
            ApproximateNumberOfMessages: "2",
            ApproximateNumberOfMessagesNotVisible: "0",
          },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

afterEach(() => {
  captured.length = 0;
  vi.restoreAllMocks();
});

/** Sends every HTTPS request the SDK makes to the local server, keeping its Host header. */
function routeAwsToLocalServer() {
  vi.spyOn(https, "request").mockImplementation(((
    options: https.RequestOptions,
    callback?: (res: http.IncomingMessage) => void,
  ) =>
    http.request(
      { ...options, protocol: "http:", hostname: "127.0.0.1", host: undefined, port, agent: false },
      callback,
    )) as typeof https.request);
}

function setup() {
  const rows = new Map<string, GovernanceIngestionSource>();
  const service = SecurityLakeSourceService.create({
    queue: SqsSecurityLakeQueueChannel.create(),
    events: MemoryOcsfEventsRepository.create(),
    projects: { findInternal: async () => ({ id: "project_governance" }) as never },
    pullRuns: { getLastPullOutcome: async () => ({ lastError: null }) },
    sources: {
      createSource: async (input) => {
        const at = new Date(1_763_300_000_000);
        const source: GovernanceIngestionSource = {
          id: "src_1",
          organizationId: input.organizationId,
          teamId: null,
          sourceType: input.sourceType,
          name: input.name,
          description: null,
          ingestSecretHash: "",
          parserConfig: input.parserConfig,
          pollerCursor: null,
          errorCount: 0,
          pullSchedule: input.pullSchedule,
          status: "awaiting_first_event",
          lastEventAt: null,
          archivedAt: null,
          createdAt: at,
          updatedAt: at,
          createdById: input.actorUserId,
        };
        rows.set(source.id, source);
        return { source };
      },
      updateSource: async () => {
        throw new Error("not used");
      },
      findById: async ({ id }) => rows.get(id) ?? null,
    },
  });
  return { service };
}

describe("Security Lake test connection", () => {
  describe("given a source whose subscriber role trusts LangWatch with the external id", () => {
    /** @scenario "Test connection assumes the subscriber role with the external id" */
    it("assumes the role with the generated external id before it reads the queue", async () => {
      routeAwsToLocalServer();
      const { service } = setup();
      const source = await service.create({
        organizationId: "org_acme",
        actorUserId: "user_1",
        name: "ACME lake",
        config: CONFIG_WITH_CALLER_EXTERNAL_ID,
        credentials: { aws_access_key_id: "AKIASTATICKEY", aws_secret_access_key: "static" },
      });

      const test = await service.testConnection({ organizationId: "org_acme", id: source.id });

      expect(test).toEqual({ ok: true, waiting: 2, inFlight: 0, error: null });
      expect(captured.map((request) => request.host.split(".")[0])).toEqual(["sts", "sqs"]);
      const assumeRole = new URLSearchParams(captured[0]!.body);
      expect(assumeRole.get("Action")).toBe("AssumeRole");
      expect(assumeRole.get("RoleArn")).toBe(ROLE_ARN);
      expect(source.externalId).toMatch(/\S{8,}/);
      expect(assumeRole.get("ExternalId")).toBe(source.externalId);
      expect(assumeRole.get("ExternalId")).not.toBe(CALLER_EXTERNAL_ID);
      expect(String(captured[1]!.headers.authorization)).toContain(TEMP_KEY);
    });
  });
});
