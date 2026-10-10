/**
 * The demo project is read dynamically for callers that configure it after boot.
 * Tests set it after module load, so capturing it once would answer the
 * wrong question.
 */
export function demoProjectId(): string | undefined {
  return process.env.DEMO_PROJECT_ID ?? undefined;
}
