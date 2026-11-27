import { describe, expect, it } from "vitest";

import {
  AwsClientConfiguration,
  MissingStaticAwsCredentialsError,
  type OutboundProxyResolver,
} from "../aws-client.ts";

const direct: OutboundProxyResolver = { tryResolveForHost: () => undefined };

describe("AwsClientConfiguration with requireStatic", () => {
  const aws = AwsClientConfiguration.create({ outboundProxy: direct });

  it.each([
    ["no pair", null],
    ["a blank pair", { accessKeyId: " ", secretAccessKey: " " }],
    ["half a pair", { accessKeyId: "AKIAACME", secretAccessKey: "" }],
  ])(
    "refuses %s instead of signing with the deployment's identity",
    (_label, staticCredentials) => {
      expect(() =>
        aws.build({
          region: "eu-west-1",
          targetHost: "sqs.eu-west-1.amazonaws.com",
          staticCredentials,
          assumeRole: { roleArn: "arn:aws:iam::444455556666:role/Other", externalId: "x" },
          requireStatic: true,
        }),
      ).toThrow(MissingStaticAwsCredentialsError);
    },
  );

  it("builds with a complete pair", () => {
    const config = aws.build({
      region: "eu-west-1",
      targetHost: "sqs.eu-west-1.amazonaws.com",
      staticCredentials: { accessKeyId: "AKIAACME", secretAccessKey: "secret" },
      requireStatic: true,
    });
    expect(config.credentials).toEqual({ accessKeyId: "AKIAACME", secretAccessKey: "secret" });
  });
});
