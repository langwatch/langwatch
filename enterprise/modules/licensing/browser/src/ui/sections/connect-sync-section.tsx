import { HStack, Text } from "@chakra-ui/react";

import { formatPeriodStart } from "../../model/hosted-services.ts";
import { useLicensingHost } from "../../model/licensing-host.ts";
import { Figure, SettingsBlock } from "../elements/settings-block.tsx";
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
    <SettingsBlock
      title="License sync"
      description="Once a day this install reports its seats in use to LangWatch and picks up a reissued license when one is waiting."
      testId="connect-sync"
    >
      <HStack width="full" gap={10} align="start" flexWrap="wrap">
        <Figure
          label="Last successful sync"
          value={formatPeriodStart({ value: sync.lastSyncAt, fallback: "It has not synced yet" })}
        />
      </HStack>
      {failure ? (
        <Text
          fontSize="sm"
          paddingX={4}
          paddingY={3}
          backgroundColor="orange.subtle"
          borderRadius="xl"
          data-testid="connect-sync-failure"
        >
          {failure}
        </Text>
      ) : null}
    </SettingsBlock>
  );
}
