/**
 * Which engine a studio run is composed onto, on each of the three shapes a
 * deployment can be in: a per-project Lambda fleet, a single engine address,
 * and a fleet named but not described.
 *
 * @see packages/features/workflow/specs/studio-lambda-stream.feature
 */
import {
  HttpWorkflowStudioStreamAdapter,
  LambdaWorkflowStudioStreamAdapter,
  UnconfiguredWorkflowStudioStreamAdapter,
  buildStudioLambdaConfig,
  type StudioLambdaFleetFields,
} from "@langwatch/workflow-server";
import { describe, expect, it } from "vitest";
import { composeApiWorkflowStudioStream } from "../api-studio-host.composition.ts";

const FIELDS: StudioLambdaFleetFields = {
  region: "eu-central-1",
  accessKeyId: "key",
  secretAccessKey: "secret",
  roleArn: "arn:aws:iam::123:role/nlp",
  imageUri: "123.dkr.ecr.eu-central-1.amazonaws.com/nlp:v9",
  cacheBucket: "langwatch-nlp-cache",
  subnetIds: ["subnet-1"],
  securityGroupIds: ["sg-1"],
};

const FLEET = buildStudioLambdaConfig({
  fields: FIELDS,
  langwatchEndpoint: "https://app.test",
  codeBlockTimeoutRawValue: undefined,
  stagingThresholdBytesRawValue: undefined,
  stagingTtlSecondsRawValue: undefined,
});

describe("given the API composes the optimization studio's dispatch", () => {
  describe("when the deployment describes a per-project Lambda fleet", () => {
    /** @scenario "A complete Lambda fleet configuration composes the Lambda path" */
    it("runs studio graphs on the project's own function", () => {
      const stream = composeApiWorkflowStudioStream({
        nlpServiceUrl: "http://127.0.0.1:5561",
        nlpLambdaFleet: FLEET,
        nlpLambdaFleetNamed: true,
      });

      expect(stream).toBeInstanceOf(LambdaWorkflowStudioStreamAdapter);
    });
  });

  describe("when the deployment names only an engine address", () => {
    /** @scenario "An absent or unusable fleet configuration leaves the HTTP path" */
    it("runs studio graphs at that address", () => {
      const stream = composeApiWorkflowStudioStream({
        nlpServiceUrl: "http://127.0.0.1:5561",
      });

      expect(stream).toBeInstanceOf(HttpWorkflowStudioStreamAdapter);
    });

    /** @scenario "A deployment with no engine at all refuses by name" */
    it("refuses by name where it names no engine at all", async () => {
      const stream = composeApiWorkflowStudioStream({
        nlpServiceUrl: undefined,
      });

      expect(stream).toBeInstanceOf(UnconfiguredWorkflowStudioStreamAdapter);
      await expect(
        stream.open({
          projectId: "project-1",
          body: { type: "is_alive" } as never,
          origin: "workflow",
        }),
      ).rejects.toThrow(/without an NLP engine address/);
    });
  });

  describe("when the deployment names a fleet it does not describe", () => {
    /** @scenario "A named but unusable fleet refuses instead of falling back" */
    it("refuses the run rather than serving it from the shared address", async () => {
      const stream = composeApiWorkflowStudioStream({
        nlpServiceUrl: "http://127.0.0.1:5561",
        nlpLambdaFleet: undefined,
        nlpLambdaFleetNamed: true,
      });

      expect(stream).not.toBeInstanceOf(HttpWorkflowStudioStreamAdapter);
      await expect(
        stream.open({
          projectId: "project-1",
          body: { type: "is_alive" } as never,
          origin: "workflow",
        }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    });
  });
});
