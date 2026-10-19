import { Banner } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { VStack } from "@langwatch/design-system/primitives";
import { OverviewDetail, SettingList } from "@langwatch/design-system/settings-card";
import { RefreshCw } from "lucide-react";

import { formatPeriodStart } from "../../model/hosted-services.ts";
import { useLicensingHost } from "../../model/licensing-host.ts";
import type { ConnectEnabledStatus } from "./connect-status.ts";

/**
 * Where the daily license sync stands, for every member: "why did judging
 * stop" is not a privileged question. A failure shows from the first one.
 * @see specs/self-hosting/connected-services/license-sync.feature
 */
export function ConnectSyncSection({ status }: { status: ConnectEnabledStatus }) {
  const host = useLicensingHost();
  const { sync } = status;
  const failure = sync.lastError
    ? host.describeFailure({
        error: { error: { code: sync.lastError.code } },
        fallbackTitle: "The last license sync did not complete",
      })
    : undefined;

  return (
    <Card
      title="License sync"
      description="Once a day this install reports its seats in use to LangWatch and picks up a reissued license when one is waiting."
      icon={<RefreshCw size={16} />}
      status={failure ? "warning" : "neutral"}
      data-testid="connect-sync"
    >
      <VStack align="stretch" gap={2}>
        <SettingList>
          <OverviewDetail label="Last successful sync">
            {formatPeriodStart({ value: sync.lastSyncAt, fallback: "It has not synced yet" })}
          </OverviewDetail>
        </SettingList>
        {failure ? (
          <Banner status="warning" data-testid="connect-sync-failure">
            {failure}
          </Banner>
        ) : null}
      </VStack>
    </Card>
  );
}
