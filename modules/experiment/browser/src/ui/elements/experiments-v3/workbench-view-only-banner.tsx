import { Banner } from "@langwatch/design-system/banner";

import {
  viewOnlyNotice,
  type WorkbenchAccess,
} from "../../../model/experiments-v3/workbench-access.ts";

/**
 * Shown when the reader's role cannot save or run this workbench, so a refused
 * control never looks like a page that stopped responding.
 * @see modules/experiment/specs/workbench-view-only-access.feature
 */
export function WorkbenchViewOnlyBanner({ access }: { access: WorkbenchAccess }) {
  return (
    <Banner status="info" placement="top" data-testid="workbench-view-only-banner">
      {viewOnlyNotice(access)}
    </Banner>
  );
}
