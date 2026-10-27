/**
 * @see modules/workflow/specs/studio-lambda-stream.feature
 */
import { ScopedSecrets } from "@langwatch/secrets";
import type { WorkflowServerConfig } from "@langwatch/workflow-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { nlpLambdaFleetSecret } from "../../workflow.channels.ts";
import { HttpWorkflowChannels } from "../http.workflow.channels.ts";

const aws = vi.hoisted(() => {
  const constructed: { client: string; config: { credentials?: unknown } }[] = [];
  const webIdentityProvider = async () => ({ accessKeyId: "from-token", secretAccessKey: "x" });
  const fromTokenFile = vi.fn((_options: { roleArn: string }) => webIdentityProvider);

  function recordingClient(client: string) {
    return class {
      constructor(config: { credentials?: unknown }) {
        constructed.push({ client, config });
      }

      destroy(): void {}
    };
  }

  return { constructed, fromTokenFile, webIdentityProvider, recordingClient };
});

vi.mock("@aws-sdk/client-lambda", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  LambdaClient: aws.recordingClient("lambda"),
}));
vi.mock("@aws-sdk/client-cloudwatch-logs", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  CloudWatchLogsClient: aws.recordingClient("logs"),
}));
vi.mock("@aws-sdk/credential-providers", () => ({ fromTokenFile: aws.fromTokenFile }));

const fleetPlacement = {
  AWS_REGION: "eu-west-1",
  role_arn: "arn:aws:iam::1:role/nlp-execution",
  image_uri: "1.dkr.ecr.eu-west-1.amazonaws.com/nlp:1",
  cache_bucket: "studio-cache",
  subnet_ids: ["subnet-1"],
  security_group_ids: ["sg-1"],
};
const staticKeys = { AWS_ACCESS_KEY_ID: "AKIA_TEST", AWS_SECRET_ACCESS_KEY: "test-secret" };
const CREDENTIALS_ROLE = "arn:aws:iam::1:role/langwatch-app";

const config: WorkflowServerConfig = {
  nlpServiceUrl: void 0,
  stagingThresholdBytes: void 0,
  stagingTtlSeconds: 600,
  relayTurnCeilingMs: void 0,
  publicBaseUrl: "https://app.test",
  nlpCodeBlockTimeoutSeconds: void 0,
};

async function composeWith(fleet: object) {
  const secrets = new ScopedSecrets(async (handle, build) =>
    build(handle === nlpLambdaFleetSecret ? JSON.stringify(fleet) : undefined),
  );
  const channels = await HttpWorkflowChannels.create({ config, secrets });

  return { engine: channels.engine, credentials: aws.constructed.map((c) => c.config.credentials) };
}

beforeEach(() => {
  aws.constructed.length = 0;
  aws.fromTokenFile.mockClear();
});

describe("given a Lambda fleet, when the studio's dispatch is composed", () => {
  describe("when the fleet names a credentials role", () => {
    /** @scenario "A fleet naming a credentials role signs through the web identity" */
    it("hands every fleet client the web-identity provider for that role", async () => {
      const { engine, credentials } = await composeWith({
        ...fleetPlacement,
        credentials_role_arn: CREDENTIALS_ROLE,
      });

      expect(engine.kind).toBe("lambda");
      expect(aws.fromTokenFile).toHaveBeenCalledWith({ roleArn: CREDENTIALS_ROLE });
      expect(aws.constructed.map((c) => c.client)).toEqual(["lambda", "lambda", "logs"]);
      expect(credentials).toEqual([
        aws.webIdentityProvider,
        aws.webIdentityProvider,
        aws.webIdentityProvider,
      ]);
    });

    /** @scenario "A fleet naming a credentials role signs through the web identity" */
    it("ignores a static key pair the fleet also names", async () => {
      const { credentials } = await composeWith({
        ...fleetPlacement,
        ...staticKeys,
        credentials_role_arn: CREDENTIALS_ROLE,
      });

      expect(aws.fromTokenFile).toHaveBeenCalledWith({ roleArn: CREDENTIALS_ROLE });
      expect(credentials.every((provided) => provided === aws.webIdentityProvider)).toBe(true);
    });
  });

  describe("when the fleet names only a static key pair", () => {
    /** @scenario "A fleet naming only a static key pair signs with those keys" */
    it("hands every fleet client that key pair and reads no web identity", async () => {
      const { engine, credentials } = await composeWith({ ...fleetPlacement, ...staticKeys });

      expect(engine.kind).toBe("lambda");
      expect(aws.fromTokenFile).not.toHaveBeenCalled();
      expect(credentials).toEqual(
        Array.from({ length: 3 }, () => ({
          accessKeyId: "AKIA_TEST",
          secretAccessKey: "test-secret",
        })),
      );
    });
  });

  describe("when the fleet names no credentials", () => {
    /** @scenario "A fleet naming no credentials refuses the boot" */
    it("constructs no fleet client and leaves studio runs refusing", async () => {
      const { engine } = await composeWith(fleetPlacement);

      expect(engine).toMatchObject({ kind: "single", perProjectEngines: true });
      expect(aws.constructed).toEqual([]);
      expect(aws.fromTokenFile).not.toHaveBeenCalled();
    });
  });
});
