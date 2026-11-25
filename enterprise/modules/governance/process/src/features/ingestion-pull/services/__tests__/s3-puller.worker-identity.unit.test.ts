// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Spec: specs/ai-governance/puller-framework/s3-polling.feature */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { S3Client } from "@aws-sdk/client-s3";
import { isDispatchError } from "@langwatch/eventing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { S3ObjectStoreChannel } from "../../../../channels/s3/s3.object-store.channel.ts";
import { findPullCredentialComplaints } from "../../rules/pull-config-shape.rules.ts";
import { S3_SOURCE_KEYS_MISSING_MESSAGE, S3PollingPullerService } from "../s3-puller.service.ts";

const WORKER_KEY = "AKIAWORKERAMBIENT0001";
const TENANT_KEY = "AKIATENANTOWNKEY0001";

const authorizations: string[] = [];
let server: Server;
let endpoint: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    authorizations.push(String(req.headers.authorization ?? ""));
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(
        '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>acme-audit</Name>' +
          "<IsTruncated>false</IsTruncated></ListBucketResult>",
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

afterEach(() => {
  authorizations.length = 0;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function pull(
  credentials: Record<string, string> | undefined,
  { deploymentAwsIdentity = false }: { deploymentAwsIdentity?: boolean } = {},
) {
  vi.stubEnv("AWS_ACCESS_KEY_ID", WORKER_KEY);
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "worker-secret");
  vi.stubEnv("AWS_SESSION_TOKEN", "worker-session-token");
  const objects = S3ObjectStoreChannel.create({ egress: { blockLocal: false, allowedHosts: [] } });
  const puller = S3PollingPullerService.create({ objects, deploymentAwsIdentity });
  const config = puller.validateConfig({
    adapter: "s3_polling",
    bucket: "acme-audit",
    prefix: "logs/",
    region: "eu-west-1",
    endpoint,
    parser: "ndjson",
    schedule: "0 * * * *",
    eventMapping: {
      source_event_id: "$.id",
      event_timestamp: "$.timestamp",
      actor: "$.user",
      action: "$.event",
      target: "$.model",
    },
  });
  return puller.runOnce({ cursor: null, ...(credentials ? { credentials } : {}) }, config);
}

describe("S3 polling pull and the worker's own AWS identity", () => {
  describe.each([
    ["no key pair", undefined],
    ["a blank secret access key", { aws_access_key_id: TENANT_KEY, aws_secret_access_key: "  " }],
    ["no access key ID", { aws_secret_access_key: "tenant-secret" }],
  ])("given a source saved with %s", (_label, credentials) => {
    /** @scenario A source without its own key pair is refused before any request is signed */
    it("refuses the run as the source's problem before any request is signed", async () => {
      const send = vi.spyOn(S3Client.prototype, "send");

      const error = await pull(credentials).catch((caught: unknown) => caught);

      expect(isDispatchError(error)).toBe(true);
      expect(error).toMatchObject({
        retryable: false,
        customerMessage: S3_SOURCE_KEYS_MISSING_MESSAGE,
      });
      expect(send).not.toHaveBeenCalled();
      expect(authorizations).toEqual([]);
    });
  });

  describe("given a source with its own key pair", () => {
    /** @scenario A source's own key pair signs every request */
    it("signs the listing with the source's key, never the worker's", async () => {
      await pull({ aws_access_key_id: ` ${TENANT_KEY} `, aws_secret_access_key: "tenant-secret" });

      expect(authorizations.length).toBeGreaterThan(0);
      for (const authorization of authorizations) {
        expect(authorization).toContain(`Credential=${TENANT_KEY}/`);
        expect(authorization).not.toContain(WORKER_KEY);
      }
    });
  });
});

describe("Saving an S3 polling source", () => {
  /** @scenario An S3 polling source cannot be saved without a complete key pair */
  it("names the missing keys when the save sends a blank pair", () => {
    expect(
      findPullCredentialComplaints({
        adapter: "s3_polling",
        credentials: { aws_access_key_id: "AKIA1", aws_secret_access_key: " " },
      }),
    ).toEqual([
      "Access keys: enter the access key ID and secret access key together; missing secret access key.",
    ]);
    expect(findPullCredentialComplaints({ adapter: "s3_polling" })).toHaveLength(1);
    expect(
      findPullCredentialComplaints({
        adapter: "s3_polling",
        credentials: { aws_access_key_id: "AKIA1", aws_secret_access_key: "secret" },
      }),
    ).toEqual([]);
  });

  it("refuses an OpenAI compliance source with no keys, which the same S3 puller would refuse", () => {
    expect(findPullCredentialComplaints({ adapter: "openai_compliance" })).toHaveLength(1);
    expect(
      findPullCredentialComplaints(
        { adapter: "openai_compliance" },
        { deploymentAwsIdentity: true },
      ),
    ).toEqual([]);
  });
});

describe("given a self-hosted deployment that reads AWS as its own identity", () => {
  describe("when a source saved with no keys at all runs after the upgrade", () => {
    /** @scenario A self-hosted S3 polling source with no access keys keeps reading as the deployment */
    it("signs the listing with the deployment's identity, as before the upgrade", async () => {
      await pull(undefined, { deploymentAwsIdentity: true });

      expect(authorizations.length).toBeGreaterThan(0);
      for (const authorization of authorizations) {
        expect(authorization).toContain(`Credential=${WORKER_KEY}/`);
      }
    });

    /** @scenario A self-hosted S3 polling source with no access keys keeps reading as the deployment */
    it("lets a new source with no keys at all be saved", () => {
      expect(
        findPullCredentialComplaints({ adapter: "s3_polling" }, { deploymentAwsIdentity: true }),
      ).toEqual([]);
    });
  });

  describe("when a source carries half a key pair", () => {
    const half = { aws_access_key_id: TENANT_KEY, aws_secret_access_key: " " };

    /** @scenario A self-hosted S3 polling source with half a key pair is refused */
    it("refuses the run before any request is signed", async () => {
      const send = vi.spyOn(S3Client.prototype, "send");

      const error = await pull(half, { deploymentAwsIdentity: true }).catch(
        (caught: unknown) => caught,
      );

      expect(error).toMatchObject({ customerMessage: S3_SOURCE_KEYS_MISSING_MESSAGE });
      expect(send).not.toHaveBeenCalled();
      expect(authorizations).toEqual([]);
    });

    /** @scenario A self-hosted S3 polling source with half a key pair is refused */
    it("refuses the save naming the missing key", () => {
      expect(
        findPullCredentialComplaints(
          { adapter: "s3_polling", credentials: half },
          { deploymentAwsIdentity: true },
        ),
      ).toEqual([
        "Access keys: enter the access key ID and secret access key together; missing secret access key.",
      ]);
    });
  });
});
