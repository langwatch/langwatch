/**
 * `/dashboards/curated/<templateId>`: a From LangWatch board at the organization level (ADR-002),
 * read in the project in view or the store project; a board made from it goes to the store.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { CuratedBoardPage } from "./curated-board.screen.tsx";
import { InStoreProject } from "./in-store-project.tsx";

export default function OrganizationCuratedScreen() {
  return (
    <InStoreProject>
      <CuratedBoardPage atOrganization />
    </InStoreProject>
  );
}
