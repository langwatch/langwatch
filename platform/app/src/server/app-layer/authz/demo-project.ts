/**
 * The demo project, read dynamically to match `isDemoProject()` in rbac.ts.
 * Tests set it after module load, so capturing it once would answer the
 * wrong question.
 */
export function demoProjectId(): string | undefined {
  return process.env.DEMO_PROJECT_ID ?? undefined;
}
