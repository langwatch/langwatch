export interface StandaloneNlpLambdaTaskLifecycle {
  execute(): Promise<void>;
  closeNlpLambda(): Promise<void>;
  closeAws(): Promise<void>;
  reportCloseError(input: { target: "nlp-lambda" | "aws"; error: unknown }): void;
}

/** Closes a standalone NLP Lambda task's clients before its AWS transport graph. */
export async function runStandaloneNlpLambdaTask(
  lifecycle: StandaloneNlpLambdaTaskLifecycle,
): Promise<void> {
  let executionFailed = false;
  let cleanupFailed = false;
  let firstCleanupFailure: unknown;

  try {
    await lifecycle.execute();
  } catch (error) {
    executionFailed = true;
    throw error;
  } finally {
    try {
      await lifecycle.closeNlpLambda();
    } catch (error) {
      lifecycle.reportCloseError({ target: "nlp-lambda", error });
      cleanupFailed = true;
      firstCleanupFailure ??= error;
    }

    try {
      await lifecycle.closeAws();
    } catch (error) {
      lifecycle.reportCloseError({ target: "aws", error });
      if (!cleanupFailed) {
        firstCleanupFailure = error;
      }
      cleanupFailed = true;
    }

    if (!executionFailed && cleanupFailed) {
      throw firstCleanupFailure;
    }
  }
}
