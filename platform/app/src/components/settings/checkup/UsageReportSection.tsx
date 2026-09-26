import { Box, HStack, Link, Text, VStack } from "@chakra-ui/react";
import { ExternalLink, Send } from "lucide-react";

import { CopyButton } from "~/components/CopyButton";
import {
  SettingsSection,
  SettingsSectionRow,
} from "~/components/settings/SettingsSection";
import { Switch } from "~/components/ui/switch";

const DOCS_URL = "https://docs.langwatch.ai/self-hosting/data-and-telemetry";

/** What the page needs from the server's preview, and nothing else. */
export interface UsageReportView {
  readonly payload: Record<string, unknown>;
  readonly switches: { readonly optional: boolean; readonly hostname: boolean };
  readonly endpoint: string;
  readonly disabled: boolean;
  readonly schemaVersion: number;
  readonly nextReportAt: string | null;
}

/**
 * What we send: the exact report, the two switches, a copy button
 * (specs/self-hosting/checkup/checkup.feature, "What we send").
 *
 * The payload is the one the sender posts, not a description of it, which is
 * what makes the section usable in a security review: a reviewer copies it
 * and reads it, rather than taking a sentence about it on trust.
 */
export function UsageReportSection({
  report,
  canManage,
  isSaving,
  onSwitch,
}: {
  report: UsageReportView;
  canManage: boolean;
  isSaving: boolean;
  onSwitch: (change: {
    optionalMetricsOptOut?: boolean;
    hostnameOptOut?: boolean;
  }) => void;
}) {
  const pretty = JSON.stringify(report.payload, null, 2);
  const host = hostOf(report.endpoint);

  return (
    <SettingsSection
      icon={<Send size={18} />}
      title="What this install sends to LangWatch"
      description={
        report.disabled
          ? "Usage reporting is switched off with DISABLE_USAGE_STATS. This is the report that would be sent."
          : `One report a day to ${host}, counts and metadata only.`
      }
      testId="checkup-usage-report"
    >
      <VStack align="stretch" gap={3} width="full">
        <SettingsSectionRow testId="checkup-switch-optional">
          <HStack width="full" justify="space-between" align="start" gap={4}>
            <VStack align="start" gap={0}>
              <Text fontWeight="medium">Usage counts and onboarding dates</Text>
              <Text fontSize="sm" color="fg.muted">
                What the install is used for and how far it got. Off leaves the
                release, the counts of organizations and projects, and the
                sign-in method.
              </Text>
            </VStack>
            <Switch
              checked={report.switches.optional}
              disabled={!canManage || isSaving}
              aria-label="Send usage counts and onboarding dates"
              inputProps={{ "data-testid": "checkup-switch-optional-input" }}
              onCheckedChange={(event) =>
                onSwitch({ optionalMetricsOptOut: !event.checked })
              }
            />
          </HStack>
        </SettingsSectionRow>
        <SettingsSectionRow testId="checkup-switch-hostname">
          <HStack width="full" justify="space-between" align="start" gap={4}>
            <VStack align="start" gap={0}>
              <Text fontWeight="medium">Hostname</Text>
              <Text fontSize="sm" color="fg.muted">
                The address this install answers on. It names your own network,
                so it has a switch of its own.
              </Text>
            </VStack>
            <Switch
              checked={report.switches.hostname}
              disabled={!canManage || isSaving}
              aria-label="Send hostname"
              inputProps={{ "data-testid": "checkup-switch-hostname-input" }}
              onCheckedChange={(event) =>
                onSwitch({ hostnameOptOut: !event.checked })
              }
            />
          </HStack>
        </SettingsSectionRow>

        <HStack justify="space-between" align="center" paddingTop={2}>
          <Text fontSize="sm" color="fg.muted">
            {report.nextReportAt
              ? `Next report at ${report.nextReportAt}. Schema version ${report.schemaVersion}.`
              : `Schema version ${report.schemaVersion}.`}{" "}
            <Link
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              color="blue.600"
            >
              Every field explained <ExternalLink size={12} />
            </Link>
          </Text>
          <CopyButton
            value={pretty}
            label="Usage report"
            aria-label="Copy usage report"
          />
        </HStack>
        <Box
          as="pre"
          data-testid="checkup-usage-report-payload"
          fontFamily="mono"
          fontSize="xs"
          padding={3}
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="10px"
          maxHeight="480px"
          overflow="auto"
          whiteSpace="pre"
        >
          {pretty}
        </Box>
      </VStack>
    </SettingsSection>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
