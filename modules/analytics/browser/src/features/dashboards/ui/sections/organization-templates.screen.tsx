/**
 * `/dashboards/templates`: the templates finder at the organization level (ADR-002). Adding one
 * makes the member's own board at once, stored in the store project, and opens it by id.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { InStoreProject } from "./in-store-project.tsx";
import { TemplatesLibrary } from "./templates-library.screen.tsx";

export default function OrganizationTemplatesScreen() {
  return (
    <InStoreProject>
      <TemplatesLibrary atOrganization />
    </InStoreProject>
  );
}
