import { Lent } from "@langwatch/browser-host/lent";
import { Banner } from "@langwatch/design-system/banner";
import { RequestAccessToken } from "@langwatch/organization-client";

import {
  viewOnlyNotice,
  type WorkbenchAccess,
} from "../../../model/experiments-v3/workbench-access.ts";

/**
 * Shown when the reader's role cannot save or run this workbench, so a refused
 * control never looks like a page that stopped responding. A Lite Member also
 * gets organization's Request access, which draws nothing for anybody else.
 * @see modules/experiment/specs/workbench-view-only-access.feature
 */
export function WorkbenchViewOnlyBanner({ access }: { access: WorkbenchAccess }) {
  return (
    <Banner
      status="info"
      placement="top"
      data-testid="workbench-view-only-banner"
      action={<Lent of={RequestAccessToken} props={{ reason: "run_experiments" }} />}
    >
      {viewOnlyNotice(access)}
    </Banner>
  );
}
