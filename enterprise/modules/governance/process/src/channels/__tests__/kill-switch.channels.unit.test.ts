/**
 * The kill switch's platform channels: the Databricks serving endpoint call as sent, and the
 * Bedrock channel's refusal to sign as the deployment itself.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { describe, expect, it } from "vitest";

import type { GovernanceHttpClient, GovernanceHttpResponse } from "../governance-http.channel.ts";
import { HttpBedrockAgentAliasChannel } from "../http/http.bedrock-agent-alias.channel.ts";
import { HttpDatabricksServingEndpointChannel } from "../http/http.databricks-serving-endpoint.channel.ts";

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
});
