import { describe, expect, it, vi } from "vitest";
import { runStandaloneNlpLambdaTask } from "../task-nlp-lambda.lifecycle";

describe("standalone NLP Lambda task lifecycle", () => {
  it("closes Lambda clients before the AWS transport after successful execution", async () => {
    const events: string[] = [];

    await runStandaloneNlpLambdaTask({
      execute: async () => {
        events.push("execute");
      },
      closeNlpLambda: async () => {
        events.push("nlp-lambda-close");
      },
      closeAws: async () => {
        events.push("aws-close");
      },
      reportCloseError: vi.fn(),
    });

    expect(events).toEqual(["execute", "nlp-lambda-close", "aws-close"]);
  });

  it("preserves task failure while exhaustively reporting both close failures", async () => {
    const taskFailure = new Error("task failed");
    const nlpCloseFailure = new Error("NLP Lambda close failed");
    const awsCloseFailure = new Error("AWS close failed");
    const events: string[] = [];
    const reportCloseError = vi.fn();

    await expect(
      runStandaloneNlpLambdaTask({
        execute: async () => {
          events.push("execute");
          throw taskFailure;
        },
        closeNlpLambda: async () => {
          events.push("nlp-lambda-close");
          throw nlpCloseFailure;
        },
        closeAws: async () => {
          events.push("aws-close");
          throw awsCloseFailure;
        },
        reportCloseError,
      }),
    ).rejects.toThrow(taskFailure);

    expect(events).toEqual(["execute", "nlp-lambda-close", "aws-close"]);
    expect(reportCloseError).toHaveBeenCalledWith({
      target: "nlp-lambda",
      error: nlpCloseFailure,
    });
    expect(reportCloseError).toHaveBeenCalledWith({ target: "aws", error: awsCloseFailure });
  });

  it("rejects with the first close failure after successful execution", async () => {
    const nlpCloseFailure = new Error("NLP Lambda close failed");
    const awsCloseFailure = new Error("AWS close failed");
    const events: string[] = [];
    const reportCloseError = vi.fn();

    await expect(
      runStandaloneNlpLambdaTask({
        execute: async () => {
          events.push("execute");
        },
        closeNlpLambda: async () => {
          events.push("nlp-lambda-close");
          throw nlpCloseFailure;
        },
        closeAws: async () => {
          events.push("aws-close");
          throw awsCloseFailure;
        },
        reportCloseError,
      }),
    ).rejects.toThrow(nlpCloseFailure);

    expect(events).toEqual(["execute", "nlp-lambda-close", "aws-close"]);
    expect(reportCloseError).toHaveBeenCalledWith({
      target: "nlp-lambda",
      error: nlpCloseFailure,
    });
    expect(reportCloseError).toHaveBeenCalledWith({ target: "aws", error: awsCloseFailure });
  });

  it("returns the AWS close failure when Lambda clients closed successfully", async () => {
    const awsCloseFailure = new Error("AWS close failed");
    const reportCloseError = vi.fn();

    await expect(
      runStandaloneNlpLambdaTask({
        execute: async () => {},
        closeNlpLambda: async () => {},
        closeAws: async () => {
          throw awsCloseFailure;
        },
        reportCloseError,
      }),
    ).rejects.toThrow(awsCloseFailure);

    expect(reportCloseError).toHaveBeenCalledWith({ target: "aws", error: awsCloseFailure });
  });
});
