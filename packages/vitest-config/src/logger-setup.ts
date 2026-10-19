import { configureLogger } from "@langwatch/observability";

/**
 * The test process's boot seam decides whether its logger speaks (Alex, 2026-09-27): silent
 * unless LANGWATCH_TEST_LOGS asks, `=1` for the test default level, any other value by name.
 */
export function configureTestLogging(testLogs: string | undefined): void {
  if (testLogs === "1") configureLogger({ environment: "test" });
  else configureLogger({ environment: "test", level: testLogs || "silent" });
}

configureTestLogging(process.env.LANGWATCH_TEST_LOGS);
