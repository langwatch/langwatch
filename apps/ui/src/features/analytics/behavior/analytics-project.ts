/** The project an analytics address is about, resolved from the organization graph rather than a second query. */

import type { AnalyticsHostProject } from "@langwatch/analytics-web/screens/analytics";

type Organization = {
  teams: ReadonlyArray<{
    projects: ReadonlyArray<{ id: string; slug: string; name: string; firstMessage?: unknown }>;
  }>;
};

export function resolveAnalyticsProject({
  organizations,
  projectId,
}: {
  organizations: readonly Organization[];
  projectId: string | undefined;
}): AnalyticsHostProject | undefined {
  if (!projectId) return void 0;
  for (const organization of organizations) {
    for (const team of organization.teams) {
      const found = team.projects.find((candidate) => candidate.id === projectId);
      if (found) {
        return {
          id: found.id,
          slug: found.slug,
          name: found.name,
          // The overview page leads with a setup prompt until the first
          // trace arrives, which is the one thing on these pages that is
          // about the project rather than about the range.
          hasFirstMessage: Boolean(found.firstMessage),
        };
      }
    }
  }
  return void 0;
}
