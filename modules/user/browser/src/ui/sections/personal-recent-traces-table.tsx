/**
 * Recent activity card on /coding-agents (placeholder, awaiting trace-web table surface).
 */

import { PersonalTracesEmptyState } from "../blocks/personal-traces-empty-state.tsx";

export function PersonalRecentTracesTable({
  projectSlug,
}: {
  /** Kept so the API-key offer can deep-link once a project is resolved. */
  projectSlug: string;
}) {
  return <PersonalTracesEmptyState projectSlug={projectSlug} />;
}
