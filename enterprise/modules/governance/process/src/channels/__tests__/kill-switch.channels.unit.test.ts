/**
 * The kill switch's platform channels: the Databricks serving endpoint call as sent, and the
 * Bedrock channel's refusal to sign as the deployment itself.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { BedrockAgentClient } from "@aws-sdk/client-bedrock-agent";
import { AwsClientConfiguration } from "@langwatch/aws-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GovernanceHttpClient, GovernanceHttpResponse } from "../governance-http.channel.ts";
import { HttpBedrockAgentAliasChannel } from "../http/http.bedrock-agent-alias.channel.ts";
import { HttpDatabricksServingEndpointChannel } from "../http/http.databricks-serving-endpoint.channel.ts";
import { KillSwitchPlatformError } from "../kill-switch-platform.channel.ts";

type Sent = { url: string; init: Parameters<GovernanceHttpClient["fetch"]>[1] };

function workspace(status: number): { http: GovernanceHttpClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const response: GovernanceHttpResponse = {
    ok: status < 400,
    status,
    statusText: status < 400 ? "OK" : "Forbidden",
    json: async () => ({}),
    text: async () => "",
  };
  return {
    sent,
    http: {
      fetch: async (url, init) => {
        sent.push({ url, init });
        return response;
      },
    },
  };
}

describe("HttpDatabricksServingEndpointChannel", () => {
  describe("when an endpoint is stopped", () => {
    it("posts to the endpoint's config:stop with the workspace token and no redirect", async () => {
      const { http, sent } = workspace(200);

      await HttpDatabricksServingEndpointChannel.create({ http }).stopEndpoint({
        workspaceUrl: "https://acme.cloud.databricks.com",
        token: "dapi-token",
        endpointName: "support-bot-prod",
      });

      expect(sent).toHaveLength(1);
      expect(sent[0]?.url).toBe(
        "https://acme.cloud.databricks.com/api/2.0/serving-endpoints/support-bot-prod/config:stop",
      );
      expect(sent[0]?.init).toMatchObject({
        method: "POST",
        body: "{}",
        followRedirects: false,
        headers: { Authorization: "Bearer dapi-token" },
      });
    });
  });

  describe("when the workspace refuses a start", () => {
    it("throws with the HTTP status as the code", async () => {
      const { http } = workspace(403);

      const error = await HttpDatabricksServingEndpointChannel.create({ http })
        .startEndpoint({
          workspaceUrl: "https://acme.cloud.databricks.com",
          token: "dapi-token",
          endpointName: "support-bot-prod",
        })
        .catch((thrown: unknown) => thrown);

      expect(error).toMatchObject({ code: "http_403" });
    });
  });
});

describe("HttpBedrockAgentAliasChannel", () => {
  describe("when the AWS connection holds neither a key pair nor a role", () => {
    it("refuses before any call, so the deployment never signs for the organisation", async () => {
      const error = await HttpBedrockAgentAliasChannel.create()
        .setInvocationState({
          credentials: {
            accessKeyId: null,
            secretAccessKey: null,
            roleArn: null,
            externalId: null,
          },
          region: "eu-west-1",
          agentId: "AGENT00001",
          agentAliasId: "ALIAS00001",
          state: "REJECT_INVOCATIONS",
        })
        .catch((thrown: unknown) => thrown);

      expect(error).toMatchObject({ code: "aws_connection_incomplete" });
    });
  });

  describe("when the connection names a role with no external id", () => {
    it("refuses before any call, so AssumeRole is never sent without one", async () => {
      const build = vi.spyOn(AwsClientConfiguration.prototype, "build");

      const error = await HttpBedrockAgentAliasChannel.create()
        .setInvocationState({
          credentials: {
            accessKeyId: null,
            secretAccessKey: null,
            roleArn: "arn:aws:iam::123456789012:role/kill-switch",
            externalId: null,
          },
          region: "eu-west-1",
          agentId: "AGENT00001",
          agentAliasId: "ALIAS00001",
          state: "REJECT_INVOCATIONS",
        })
        .catch((thrown: unknown) => thrown);

      expect(error).toMatchObject({ code: "aws_external_id_missing" });
      expect(build).not.toHaveBeenCalled();
    });
  });

  describe("when the connection names a role and its external id", () => {
    afterEach(() => vi.restoreAllMocks());

    it("assumes the role with that external id", async () => {
      const build = vi.spyOn(AwsClientConfiguration.prototype, "build").mockImplementation(
        ({ region }) =>
          ({
            region,
            endpoint: "http://127.0.0.1:9",
            credentials: { accessKeyId: "AKIATESTONLY0000", secretAccessKey: "test-only-secret" },
            maxAttempts: 1,
          }) as ReturnType<AwsClientConfiguration["build"]>,
      );

      await HttpBedrockAgentAliasChannel.create()
        .setInvocationState({
          credentials: {
            accessKeyId: null,
            secretAccessKey: null,
            roleArn: "arn:aws:iam::123456789012:role/kill-switch",
            externalId: "langwatch-generated-0001",
          },
          region: "eu-west-1",
          agentId: "AGENT00001",
          agentAliasId: "ALIAS00001",
          state: "REJECT_INVOCATIONS",
        })
        .catch(() => undefined);

      expect(build.mock.calls[0]?.[0].assumeRole).toMatchObject({
        roleArn: "arn:aws:iam::123456789012:role/kill-switch",
        externalId: "langwatch-generated-0001",
      });
    });
  });

  describe("when Bedrock answers an invocation state LangWatch does not know", () => {
    afterEach(() => vi.restoreAllMocks());

    /** @scenario "A Bedrock alias in an invocation state LangWatch does not know is refused" */
    it("refuses the read with bedrock_alias_state_unknown and sends no update", async () => {
      vi.spyOn(AwsClientConfiguration.prototype, "build").mockImplementation(
        ({ region }) =>
          ({
            region,
            credentials: { accessKeyId: "AKIATESTONLY0000", secretAccessKey: "test-only-secret" },
            maxAttempts: 1,
          }) as ReturnType<AwsClientConfiguration["build"]>,
      );
      const send = vi.spyOn(BedrockAgentClient.prototype, "send").mockImplementation(async () => ({
        agentAlias: { agentAliasName: "prod", aliasInvocationState: "PAUSE_INVOCATIONS" },
      }));
      const target = {
        credentials: {
          accessKeyId: "AKIATESTONLY0000",
          secretAccessKey: "test-only-secret",
          roleArn: null,
          externalId: null,
        },
        region: "eu-west-1",
        agentId: "AGENT00001",
        agentAliasId: "ALIAS00001",
      };
      const channel = HttpBedrockAgentAliasChannel.create();

      const read = await channel.getInvocationState(target).catch((thrown: unknown) => thrown);
      const set = await channel
        .setInvocationState({ ...target, state: "REJECT_INVOCATIONS" })
        .catch((thrown: unknown) => thrown);

      expect(read).toMatchObject({ code: "bedrock_alias_state_unknown" });
      expect(set).toMatchObject({ code: "bedrock_alias_state_unknown" });
      expect(send).toHaveBeenCalledTimes(2);
    });
  });
});

describe("KillSwitchPlatformError", () => {
  it("takes a platform code and refuses free text at compile time", () => {
    expect(new KillSwitchPlatformError({ code: "http_404", message: "gone" }).code).toBe(
      "http_404",
    );
    // @ts-expect-error a free string is not a kill switch platform code
    expect(new KillSwitchPlatformError({ code: "oops", message: "x" }).code).toBe("oops");
  });
});
