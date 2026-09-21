import { HStack, Text, VStack } from "@chakra-ui/react";

import { SettingsSection } from "~/components/settings/SettingsSection";
import { resolveErrorCopy } from "~/features/errors";

import { type ConnectEnabledView, formatPeriodStart } from "./connectStatus";

interface ConnectSyncSectionProps {
  status: ConnectEnabledView;
}

/**
 * Where the daily license sync stands.
 *
 * Every member sees this, not only admins: the answer to "why did judging
 * stop" lives here, and that question is not privileged. A failure is shown
 * from the first one, so an outbound rule can be fixed before a seat change
 * or a renewal is waiting on the sync. Running the sync by hand is on the
 * License page, beside the seats it changes.
 *
 * Spec: specs/self-hosting/connected-services/license-sync.feature
 */
export function ConnectSyncSection({ status }: ConnectSyncSectionProps) {
  const { sync } = status;
  const copy = sync.lastError
    ? resolveErrorCopy({
        error: { error: { code: sync.lastError.code } },
        fallbackTitle: "The last license sync did not complete",
      })
    : null;

  return (
    <SettingsSection
      title="License sync"
      description="Once a day this install reports its seats in use to LangWatch and picks up a reissued license when one is waiting."
      testId="connect-sync"
    >
      <VStack width="full" align="stretch" gap={4}>
        <HStack width="full" gap={10} align="start" flexWrap="wrap">
          <Figure
            label="Last successful sync"
            value={
              formatPeriodStart(sync.lastSyncAt) ?? "It has not synced yet"
            }
          />
        </HStack>
        {copy ? (
          <VStack
            align="start"
            gap={0.5}
            paddingX={4}
            paddingY={3}
            backgroundColor="orange.subtle"
            borderRadius="xl"
            data-testid="connect-sync-failure"
          >
            <Text fontSize="sm" fontWeight="medium">
              {copy.title}
            </Text>
            {copy.description ? (
              <Text fontSize="sm" color="fg.muted">
                {copy.description}
              </Text>
            ) : null}
          </VStack>
        ) : null}
      </VStack>
    </SettingsSection>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <VStack align="start" gap={0.5}>
      <Text fontSize="sm" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="lg" fontWeight={600}>
        {value}
      </Text>
    </VStack>
  );
}
