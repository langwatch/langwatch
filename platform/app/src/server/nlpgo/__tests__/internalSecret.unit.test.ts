/**
 * @vitest-environment node
 *
 * The app -> nlpgo hop is authenticated by a shared secret in the
 * X-LangWatch-NLP-Secret header. Two things have to hold for every install:
 * with LANGWATCH_NLP_INTERNAL_SECRET set the header reaches nlpgo, and with it
 * unset nothing is sent and nothing throws — that second branch is what keeps
 * an existing self-hosted .env that predates the variable booting and running.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NLP_INTERNAL_SECRET_HEADER,
  nlpgoInternalHeaders,
} from "../internalSecret";

const lambdaFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../../../utils/lambdaFetch", () => ({
  lambdaFetch: lambdaFetchMock,
}));

vi.mock("../../../optimization_studio/server/lambda", () => ({
  getProjectLambdaArn: vi.fn(),
}));

import { nlpgoFetch } from "../nlpgoFetch";

describe("nlpgo internal secret", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lambdaFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({}),
      text: async () => "",
    });
    vi.stubEnv("LANGWATCH_NLP_SERVICE", "http://localhost:5561");
    vi.stubEnv("LANGWATCH_NLP_LAMBDA_CONFIG", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("nlpgoInternalHeaders", () => {
    describe("when LANGWATCH_NLP_INTERNAL_SECRET is set", () => {
      /** @scenario "the shared helper carries the secret when one is configured" */
      it("returns the secret header", () => {
        vi.stubEnv("LANGWATCH_NLP_INTERNAL_SECRET", "s3cr3t");

        expect(nlpgoInternalHeaders()).toEqual({
          [NLP_INTERNAL_SECRET_HEADER]: "s3cr3t",
        });
      });

      it("trims surrounding whitespace so a padded .env line still matches", () => {
        vi.stubEnv("LANGWATCH_NLP_INTERNAL_SECRET", "  s3cr3t  ");

        expect(nlpgoInternalHeaders()).toEqual({
          [NLP_INTERNAL_SECRET_HEADER]: "s3cr3t",
        });
      });
    });

    describe("when LANGWATCH_NLP_INTERNAL_SECRET is unset", () => {
      /** @scenario "the shared helper carries nothing when none is configured" */
      it("returns no headers", () => {
        vi.stubEnv("LANGWATCH_NLP_INTERNAL_SECRET", undefined);

        expect(nlpgoInternalHeaders()).toEqual({});
      });

      it("returns no headers for an empty value", () => {
        vi.stubEnv("LANGWATCH_NLP_INTERNAL_SECRET", "   ");

        expect(nlpgoInternalHeaders()).toEqual({});
      });
    });
  });

  describe("nlpgoFetch", () => {
    const call = () =>
      nlpgoFetch({
        projectId: "project_1",
        path: "/studio/execute_sync",
        body: { hello: "world" },
        origin: "workflow",
      });

    const sentHeaders = (): Record<string, string> =>
      lambdaFetchMock.mock.calls[0]![2].headers;

    describe("when LANGWATCH_NLP_INTERNAL_SECRET is set", () => {
      /** @scenario "the shared helper carries the secret when one is configured" */
      it("passes the secret header to the transport", async () => {
        vi.stubEnv("LANGWATCH_NLP_INTERNAL_SECRET", "s3cr3t");

        await call();

        expect(sentHeaders()).toMatchObject({
          "Content-Type": "application/json",
          "X-LangWatch-Origin": "workflow",
          [NLP_INTERNAL_SECRET_HEADER]: "s3cr3t",
        });
      });
    });

    describe("when LANGWATCH_NLP_INTERNAL_SECRET is unset", () => {
      /** @scenario "the shared helper carries nothing when none is configured" */
      it("omits the secret header and still dispatches", async () => {
        vi.stubEnv("LANGWATCH_NLP_INTERNAL_SECRET", undefined);

        const result = await call();

        expect(result.ok).toBe(true);
        expect(sentHeaders()).not.toHaveProperty(NLP_INTERNAL_SECRET_HEADER);
      });
    });
  });
});
