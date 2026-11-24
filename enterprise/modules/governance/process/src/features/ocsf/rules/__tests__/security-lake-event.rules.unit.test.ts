/** Spec: enterprise/modules/governance/specs/security-lake-ingest.feature */
import { securityLakePullConfigSchema } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { findPullConfigComplaints } from "../../../ingestion-pull/rules/pull-config-shape.rules.ts";
import {
  aiTargetOf,
  isAiActivityEvent,
  isSelectedSecurityLakeObject,
  parseSecurityLakeNotification,
  securityLakeRowToEvent,
} from "../security-lake-event.rules.ts";

const BASE_CONFIG = {
  adapter: "aws_security_lake",
  region: "eu-west-1",
  subscriberRoleArn: "arn:aws:iam::123456789012:role/AmazonSecurityLake-subscriber",
  externalId: "acme-external-id",
  queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-subscriber",
};

describe("security lake source configuration", () => {
  describe("given an admin saves the required fields only", () => {
    /** @scenario A Security Lake source reads CloudTrail management and data events by default */
    it("reads the three CloudTrail sources", () => {
      const config = securityLakePullConfigSchema.parse(BASE_CONFIG);
      expect(config.sources).toEqual(["CLOUD_TRAIL_MGMT", "S3_DATA", "LAMBDA_EXECUTION"]);
    });
  });

  describe("given a malformed role ARN and Region", () => {
    /** @scenario A Security Lake source with a malformed role ARN or Region is refused by field */
    it("names both fields in the complaints", () => {
      const complaints = findPullConfigComplaints({
        ...BASE_CONFIG,
        subscriberRoleArn: "not-an-arn",
        region: "Europe",
      });
      expect(complaints.some((line) => line.startsWith("Subscriber role ARN:"))).toBe(true);
      expect(complaints.some((line) => line.startsWith("Region:"))).toBe(true);
    });
  });
});

describe("parseSecurityLakeNotification", () => {
  describe("given the S3 test event and an SNS-wrapped notification", () => {
    /** @scenario The S3 test event and SNS-wrapped notifications are understood */
    it("ignores the test event and reads the wrapped bucket and key", () => {
      expect(parseSecurityLakeNotification(JSON.stringify({ Event: "s3:TestEvent" }))).toEqual({
        kind: "ignored",
      });
      const s3 = {
        Records: [
          {
            eventName: "ObjectCreated:Put",
            s3: {
              bucket: { name: "aws-security-data-lake-eu-west-1-acme" },
              object: { key: "aws/CLOUD_TRAIL_MGMT/2.0/region%3Deu-west-1/file+1.parquet" },
            },
          },
        ],
      };
      const wrapped = JSON.stringify({ Type: "Notification", Message: JSON.stringify(s3) });
      expect(parseSecurityLakeNotification(wrapped)).toEqual({
        kind: "objects",
        objects: [
          {
            bucket: "aws-security-data-lake-eu-west-1-acme",
            key: "aws/CLOUD_TRAIL_MGMT/2.0/region=eu-west-1/file 1.parquet",
          },
        ],
      });
    });

    it("reads the EventBridge Object Created shape", () => {
      const body = JSON.stringify({
        "detail-type": "Object Created",
        detail: { bucket: { name: "lake" }, object: { key: "aws/S3_DATA/2.0/a.parquet" } },
      });
      expect(parseSecurityLakeNotification(body)).toEqual({
        kind: "objects",
        objects: [{ bucket: "lake", key: "aws/S3_DATA/2.0/a.parquet" }],
      });
    });

    /** @scenario An EventBridge Object Deleted notification is acknowledged without a read */
    it("ignores an EventBridge Object Deleted notification", () => {
      const body = JSON.stringify({
        "detail-type": "Object Deleted",
        detail: { bucket: { name: "lake" }, object: { key: "aws/S3_DATA/2.0/a.parquet" } },
      });
      expect(parseSecurityLakeNotification(body)).toEqual({ kind: "ignored" });
    });

    it("calls a body that is not JSON unreadable", () => {
      expect(parseSecurityLakeNotification("not json").kind).toBe("unreadable");
    });
  });
});

describe("isSelectedSecurityLakeObject", () => {
  it("matches the source segment after aws/", () => {
    const key = "aws/S3_DATA/2.0/region=eu-west-1/accountId=1/eventDay=20261116/a.parquet";
    expect(isSelectedSecurityLakeObject({ key, sources: ["S3_DATA"] })).toBe(true);
    expect(isSelectedSecurityLakeObject({ key, sources: ["CLOUD_TRAIL_MGMT"] })).toBe(false);
    expect(
      isSelectedSecurityLakeObject({ key: "ext/custom/a.parquet", sources: ["S3_DATA"] }),
    ).toBe(false);
  });
});

describe("isAiActivityEvent and aiTargetOf", () => {
  it("counts a streaming call once and drops its AwsServiceEvent completion", () => {
    const stream = (eventCode: string) => ({
      metadata: { event_code: eventCode },
      api: { operation: "ConverseStream", service: { name: "bedrock.amazonaws.com" } },
    });
    expect(isAiActivityEvent(stream("AwsApiCall"))).toBe(true);
    expect(isAiActivityEvent(stream("AwsServiceEvent"))).toBe(false);
    expect(
      isAiActivityEvent({ ...stream("AwsApiCall"), unmapped: { eventType: "AwsServiceEvent" } }),
    ).toBe(true);
  });

  it("keeps Bedrock, AgentCore and SageMaker invocations and drops the rest", () => {
    const call = (name: string, operation: string) => ({ api: { operation, service: { name } } });
    expect(isAiActivityEvent(call("bedrock.amazonaws.com", "InvokeModel"))).toBe(true);
    expect(isAiActivityEvent(call("bedrock.amazonaws.com", "Converse"))).toBe(true);
    expect(isAiActivityEvent(call("bedrock-agent-runtime.amazonaws.com", "InvokeAgent"))).toBe(
      true,
    );
    expect(isAiActivityEvent(call("bedrock-agentcore.amazonaws.com", "InvokeAgentRuntime"))).toBe(
      true,
    );
    expect(isAiActivityEvent(call("sagemaker.amazonaws.com", "InvokeEndpoint"))).toBe(true);
    expect(isAiActivityEvent(call("bedrock.amazonaws.com", "ListFoundationModels"))).toBe(false);
    expect(isAiActivityEvent(call("s3.amazonaws.com", "GetObject"))).toBe(false);
    expect(isAiActivityEvent(call("q.amazonaws.com", "SendMessage"))).toBe(false);
  });

  it.each([
    "InvokeAgent",
    "InvokeInlineAgent",
    "InvokeFlow",
    "RetrieveAndGenerate",
    "RetrieveAndGenerateStream",
    "Retrieve",
  ])("keeps the Bedrock agent call %s under both Bedrock event sources", (operation) => {
    const call = (name: string) => ({ api: { operation, service: { name } } });
    expect(isAiActivityEvent(call("bedrock.amazonaws.com"))).toBe(true);
    expect(isAiActivityEvent(call("bedrock-agent-runtime.amazonaws.com"))).toBe(true);
  });

  it("reads the model id from the request data, then from the resources", () => {
    expect(
      aiTargetOf({
        api: { request: { data: JSON.stringify({ modelId: "anthropic.claude-v5" }) } },
      }),
    ).toBe("anthropic.claude-v5");
    expect(
      aiTargetOf({
        resources: [{ uid: "arn:aws:bedrock:eu-west-1::foundation-model/amazon.nova-pro-v1:0" }],
      }),
    ).toBe("amazon.nova-pro-v1:0");
  });
});

describe("securityLakeRowToEvent", () => {
  describe("given a Bedrock call with no metadata uid", () => {
    /** @scenario An event without a metadata uid gets a stable identity */
    it("derives the same uid from the same row", () => {
      const row = {
        class_uid: 6003,
        severity_id: 1,
        time: 1_763_300_000_000n,
        metadata: { version: "1.1.0", uid: null },
        api: { operation: "InvokeModel", service: { name: "bedrock.amazonaws.com" } },
      };
      const first = securityLakeRowToEvent(row);
      const second = securityLakeRowToEvent(structuredClone(row));
      expect(first.kind).toBe("event");
      if (first.kind !== "event" || second.kind !== "event") return;
      expect(first.event.metadata.uid).toMatch(/^sha256:/);
      expect(first.event.metadata.uid).toBe(second.event.metadata.uid);
      expect(first.event.time).toBe(1_763_300_000_000);
    });
  });

  it("calls a row without a class or time invalid", () => {
    expect(securityLakeRowToEvent({ metadata: { uid: "x" } }).kind).toBe("invalid");
  });
});
