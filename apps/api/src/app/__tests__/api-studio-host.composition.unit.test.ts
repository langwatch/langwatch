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
} from "@langwatch/workflow-server";
import { describe, expect, it } from "vitest";
import { composeApiWorkflowStudioStream } from "../api-studio-host.composition.ts";

const FLEET = JSON.stringify({
  AWS_REGION: "eu-central-1",
  AWS_ACCESS_KEY_ID: "key",
  AWS_SECRET_ACCESS_KEY: "secret",
  role_arn: "arn:aws:iam::123:role/nlp",
  image_uri: "123.dkr.ecr.eu-central-1.amazonaws.com/nlp:v9",
  cache_bucket: "langwatch-nlp-cache",
  subnet_ids: ["subnet-1"],
  security_group_ids: ["sg-1"],
});

describe("given the API composes the optimization studio's dispatch", () => {
  describe("when the deployment describes a per-project Lambda fleet", () => {
    /** @scenario "A complete Lambda fleet configuration composes the Lambda path" */
    it("runs studio graphs on the project's own function", () => {
      const stream = composeApiWorkflowStudioStream({
        nlpServiceUrl: "http://127.0.0.1:5561",
        environment: { LANGWATCH_NLP_LAMBDA_CONFIG: FLEET, BASE_HOST: "https://app.test" },
      });

      expect(stream).toBeInstanceOf(LambdaWorkflowStudioStreamAdapter);
    });
  });

  describe("when the deployment names only an engine address", () => {
    /** @scenario "An absent or unusable fleet configuration leaves the HTTP path" */
    it("runs studio graphs at that address", () => {
      const stream = composeApiWorkflowStudioStream({
        nlpServiceUrl: "http://127.0.0.1:5561",
        environment: {},
      });

      expect(stream).toBeInstanceOf(HttpWorkflowStudioStreamAdapter);
    });

    /** @scenario "A deployment with no engine at all refuses by name" */
    it("refuses by name where it names no engine at all", async () => {
      const stream = composeApiWorkflowStudioStream({
        nlpServiceUrl: undefined,
        environment: {},
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
        environment: { LANGWATCH_NLP_LAMBDA_CONFIG: '{"AWS_REGION":"eu-central-1"}' },
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
