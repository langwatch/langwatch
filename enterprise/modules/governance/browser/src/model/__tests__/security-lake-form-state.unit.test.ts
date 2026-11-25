// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The update input the Security Lake edit form sends.
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import {
  securityLakeConnectionTestInputSchema,
  securityLakeSourceCreateInputSchema,
  securityLakeSourceUpdateInputSchema,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import {
  blankSecurityLakeForm,
  securityLakeCreateInput,
  securityLakeFormFromSource,
  securityLakeTestInput,
  securityLakeUpdateInput,
} from "../security-lake-form-state.ts";

const saved = securityLakeFormFromSource({
  name: "ACME Security Lake",
  parserConfig: {
    region: "eu-west-1",
    subscriberRoleArn: "arn:aws:iam::123456789012:role/acme-lake-subscriber",
    queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-lake",
    sources: ["CLOUD_TRAIL_MGMT"],
    s3Endpoint: "https://s3.vpce.example.com",
    sqsEndpoint: "https://sqs.vpce.example.com",
  },
});

describe("securityLakeUpdateInput", () => {
  it("sends null for a cleared endpoint so the stored override is removed", () => {
    const input = securityLakeUpdateInput({ ...saved, s3Endpoint: "", sqsEndpoint: "" });
    expect(input.config.s3Endpoint).toBeNull();
    expect(input.config.sqsEndpoint).toBeNull();
    expect(securityLakeSourceUpdateInputSchema.validate(input)).toBe(true);
  });

  it("keeps a set endpoint as typed", () => {
    const input = securityLakeUpdateInput({ ...saved, sqsEndpoint: "" });
    expect(input.config.s3Endpoint).toBe("https://s3.vpce.example.com");
    expect(input.config.sqsEndpoint).toBeNull();
  });

  it("leaves out the blank keys so the stored ones stay, and never sends an external id", () => {
    const input = securityLakeUpdateInput(saved);
    expect(input.config).not.toHaveProperty("externalId");
    expect(input).not.toHaveProperty("credentials");
  });
});

describe("securityLakeCreateInput", () => {
  it("sends no external id, since LangWatch generates it", () => {
    const input = securityLakeCreateInput({
      ...blankSecurityLakeForm(),
      region: "eu-west-1",
      subscriberRoleArn: "arn:aws:iam::123456789012:role/acme-lake-subscriber",
      queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-lake",
      accessKeyId: "AKIAACME",
      secretAccessKey: "secret",
    });
    expect(input.config).not.toHaveProperty("externalId");
    expect(securityLakeSourceCreateInputSchema.validate(input)).toBe(true);
  });
});

describe("securityLakeTestInput", () => {
  it("sends the form's settings, and its keys only when typed", () => {
    const queueUrl = "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-fixed";
    const kept = securityLakeTestInput({ ...saved, queueUrl });
    const typed = securityLakeTestInput({
      ...saved,
      accessKeyId: "AKIAFORM",
      secretAccessKey: "form-secret",
    });

    expect(kept.config.queueUrl).toBe(queueUrl);
    expect(kept).not.toHaveProperty("credentials");
    expect(kept).not.toHaveProperty("name");
    expect(typed.credentials).toEqual({
      aws_access_key_id: "AKIAFORM",
      aws_secret_access_key: "form-secret",
    });
    expect(securityLakeConnectionTestInputSchema.validate(typed)).toBe(true);
  });
});
