/**
 * The cloud agent source forms read back: the configs their builders hand the adapter, what a
 * test connection sends, and the words each test answer is shown with.
 */
import { describe, expect, it } from "vitest";

import { parseDormancyDays } from "../../../../features/agents/agent-registry-settings.ts";
import { agentListingTestCopy } from "../../../../features/ingestion-sources/model/agent-listing-test-copy.ts";
import {
  agentListingTestInput,
  buildAwsBedrockAgentsPullConfig,
  buildGcpVertexAgentEnginePullConfig,
  parseTargets,
  serializeTargets,
} from "../inventory/cloud-agent-pull-config.ts";
import { blankComposer, type ComposerState } from "../inventory/source-composer-state.ts";
import { seedComposerParserConfig } from "../inventory/source-submission.ts";

function composer(overrides: Partial<ComposerState>): ComposerState {
  return { ...blankComposer(), name: "ACME cloud", ...overrides };
}

describe("the AWS source config", () => {
  it("lists every region chip and the picked connection", () => {
    const config = buildAwsBedrockAgentsPullConfig(
      composer({
        sourceType: "aws_bedrock_agents",
        parserConfig: { awsConnectionId: "awsconn_1", regions: "eu-west-1, us-east-1" },
      }),
    );
    expect(config).toEqual({
      adapter: "aws_bedrock_agents",
      awsConnectionId: "awsconn_1",
      regions: ["eu-west-1", "us-east-1"],
      schedule: "0 * * * *",
    });
  });

  it("refuses a region that is not a region code", () => {
    const config = buildAwsBedrockAgentsPullConfig(
      composer({
        sourceType: "aws_bedrock_agents",
        parserConfig: { awsConnectionId: "awsconn_1", regions: "not-a-region" },
      }),
    );
    expect(config).toBeNull();
  });
});

describe("the Google Cloud source config", () => {
  const rows = [
    { projectId: "acme-ml", location: "europe-west4" },
    { projectId: "acme-ml", location: "us-central1" },
  ];

  it("reads the project rows and seals the key under credentials", () => {
    const config = buildGcpVertexAgentEnginePullConfig(
      composer({
        sourceType: "gcp_vertex_agent_engine",
        parserConfig: { targets: serializeTargets(rows), credentialsServiceAccountJson: "{}" },
      }),
    );
    expect(config).toMatchObject({ targets: rows, credentials: { serviceAccountJson: "{}" } });
  });

  it("keeps the stored key on edit when the field is blank", () => {
    const config = buildGcpVertexAgentEnginePullConfig(
      composer({
        sourceType: "gcp_vertex_agent_engine",
        parserConfig: { targets: serializeTargets(rows) },
      }),
      { shouldRequireCredentials: false },
    );
    expect(config).not.toHaveProperty("credentials");
  });

  it("opens an edit on the saved rows", () => {
    const seeded = seedComposerParserConfig({
      sourceType: "gcp_vertex_agent_engine",
      storedParserConfig: { targets: rows },
    });
    expect(parseTargets(seeded.targets ?? "")).toEqual(rows);
    expect(seeded.credentialsServiceAccountJson).toBe("");
  });

  it("holds nothing while every row is blank, so the required check can see it", () => {
    expect(serializeTargets([{ projectId: "", location: "" }])).toBe("");
  });
});

describe("a test connection on an unsaved draft", () => {
  it("sends the config with its secret split out", () => {
    const input = agentListingTestInput(
      composer({
        sourceType: "ard_registry",
        parserConfig: { registryUrl: "registry.acme.test", credentialsBearerToken: "tok" },
      }),
    );
    expect(input).toEqual({
      sourceType: "ard_registry",
      config: { adapter: "ard_registry", registryUrl: "registry.acme.test", schedule: "0 * * * *" },
      credentials: { bearerToken: "tok" },
    });
  });

  it("cannot run until the draft is complete", () => {
    expect(
      agentListingTestInput(composer({ sourceType: "ard_registry", parserConfig: {} })),
    ).toBeNull();
  });
});

describe("what a test connection says", () => {
  it("counts the agents found", () => {
    expect(agentListingTestCopy({ outcome: "listed", agentCount: 3 }).title).toBe("3 agents found");
    expect(agentListingTestCopy({ outcome: "listed", agentCount: 1 }).title).toBe("1 agent found");
  });

  it("explains a refusal by its reason, and falls back for an unknown one", () => {
    const refused = agentListingTestCopy({
      outcome: "refused",
      reason: "unauthorized",
      status: 401,
    });
    expect(refused.status).toBe("error");
    expect(refused.description).toContain("sign-in");
    const unknown = agentListingTestCopy({ outcome: "refused", reason: "toString", status: null });
    expect(unknown.description).toContain("would not list");
  });
});

describe("the dormancy window input", () => {
  it("takes a whole number of days from 1 to 365", () => {
    expect(parseDormancyDays("14")).toBe(14);
    expect(parseDormancyDays("0")).toBeNull();
    expect(parseDormancyDays("366")).toBeNull();
    expect(parseDormancyDays("7.5")).toBeNull();
  });
});
