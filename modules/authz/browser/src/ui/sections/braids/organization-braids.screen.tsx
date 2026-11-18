/**
 * The organisation's Braids screen, for its admins: whether Braids is on, who may braid and every
 * live braid. Below Enterprise each setting shows the upsell, never a dead switch. Spec:
 * modules/authz/specs/braids-screen.feature, "An organisation turns Braids on in settings".
 */

import { Link } from "@langwatch/browser-host/link";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, Button, Skeleton, Stack } from "@langwatch/design-system/primitives";
import { SettingsSection } from "@langwatch/design-system/settings-section";
import { Switch } from "@langwatch/design-system/switch";
import { ToggleRow } from "@langwatch/design-system/toggle-row";

import {
  useBraidsPolicy,
  useBraidsReleased,
  useOrganizationBraids,
  useSetBraidsSettings,
} from "../../../behavior/use-braids.ts";
import { useAuthzHost } from "../../../model/authz-host.ts";
import {
  BRAIDS_GUIDE_HREF,
  braidsPauses,
  braidsPlanState,
  braidsStatus,
  organizationBraidRows,
} from "../../../model/braids/braids.ts";
import { OrganizationBraidsTable } from "../../blocks/braids/organization-braids-table.tsx";
import { BraidsNotEnabledBanner } from "../../elements/braids-not-enabled-banner.tsx";
import { BraidsPageLinks } from "../../elements/braids-page-links.tsx";
import { BraidsPlanPausedBanner } from "../../elements/braids-plan-paused-banner.tsx";
import { BraidsTitle } from "../../elements/braids-title.tsx";
import { NO_RULE_UNDER_HEADER } from "../../elements/no-rule-under-header.ts";
import { SectionErrorNotice } from "../../elements/section-error-notice.tsx";

const KEEP_TO_ADMINS = "Keep braids to organisation admins";
const ENABLE_BRAIDS = "Enable Braids";

/** The organisation's own switch for Braids (Alex, 2026-11-18): off by default, off pauses. */
function EnableBraids({
  isEnterprise,
  enabled,
  isReading,
  unread,
  stale,
  isSaving,
  onChange,
  onRetry,
}: {
  isEnterprise: boolean;
  enabled: boolean;
  isReading: boolean;
  /** The setting has never been read: no switch, so no guess, and Retry asks again. */
  unread: boolean;
  /** A refresh failed over a value read before: that value shows, held, beside Retry. */
  stale: boolean;
  /** Either organisation setting is saving, so neither switch can race the other. */
  isSaving: boolean;
  onChange: (braidsEnabled: boolean) => void;
  onRetry: () => void;
}) {
  const unknown = isEnterprise && unread;
  const retry = (
    <Button size="xs" variant="outline" onClick={onRetry} data-testid="braids-enabled-retry">
      Retry
    </Button>
  );
  let hint = "Braids is included in Enterprise.";
  let control = (
    <Button asChild colorPalette="orange" size="xs">
      <Link href="/settings/plans">See plans</Link>
    </Button>
  );
  if (unknown) {
    hint = "Couldn't read whether Braids is on for this organisation.";
    control = retry;
  } else if (isEnterprise && stale) {
    hint = "Couldn't refresh whether Braids is on, so this is the setting as last read.";
    control = (
      <Stack direction="row" gap={2} align="center">
        {retry}
        <Switch
          checked={enabled}
          disabled
          inputProps={{ "aria-label": ENABLE_BRAIDS }}
          data-testid="braids-enabled-switch"
        />
      </Stack>
    );
  } else if (isEnterprise) {
    hint =
      "Turn it on and projects can braid. Turning it off pauses every braid and keeps it: the spans stop showing within 30 seconds and come back when you turn Braids on again.";
    // Until the setting answers there is no state to show, so a placeholder, not a guess.
    control = isReading ? (
      <Skeleton
        height="20px"
        width="36px"
        borderRadius="full"
        data-testid="braids-enabled-loading"
      />
    ) : (
      <Switch
        checked={enabled}
        disabled={isSaving}
        onCheckedChange={({ checked }) => onChange(checked)}
        inputProps={{ "aria-label": ENABLE_BRAIDS }}
        data-testid="braids-enabled-switch"
      />
    );
  }
  return (
    <SettingsSection
      title={ENABLE_BRAIDS}
      hint="Whether this organisation's projects can show each other's matching spans."
    >
      <ToggleRow
        label={ENABLE_BRAIDS}
        on={isEnterprise && !unknown && enabled}
        hint={hint}
        data-testid="braids-enabled-row"
      >
        {control}
      </ToggleRow>
    </SettingsSection>
  );
}

function OrganizationBraidsHeader({ locked = false }: { locked?: boolean }) {
  return (
    <PageLayout.Header
      description={
        <>
          Every braid in your organisation, and who may create, change or remove them.
          <BraidsPageLinks />
        </>
      }
    >
      <BraidsTitle locked={locked} />
    </PageLayout.Header>
  );
}

function WhoMayBraid({
  isEnterprise,
  keptToAdmins,
  isReading,
  isSaving,
  onChange,
}: {
  isEnterprise: boolean;
  keptToAdmins: boolean;
  isReading: boolean;
  /** Either organisation setting is saving, so neither switch can race the other. */
  isSaving: boolean;
  onChange: (keptToAdmins: boolean) => void;
}) {
  return (
    <SettingsSection
      title="Who may braid"
      hint="Who can create, change or remove braids in this organisation's projects."
    >
      <ToggleRow
        label={KEEP_TO_ADMINS}
        on={isEnterprise && keptToAdmins}
        hint={
          isEnterprise
            ? "While this is off, project admins can braid their projects. Turn it on and only organisation admins can."
            : "Choosing who may braid is included in Enterprise."
        }
        data-testid={isEnterprise ? undefined : "braids-policy-upsell"}
      >
        {isEnterprise ? (
          <Switch
            checked={keptToAdmins}
            disabled={isReading || isSaving}
            onCheckedChange={({ checked }) => onChange(checked)}
            inputProps={{ "aria-label": KEEP_TO_ADMINS }}
            data-testid="braids-policy-switch"
          />
        ) : (
          <Button asChild colorPalette="orange" size="xs">
            <Link href="/settings/plans">See plans</Link>
          </Button>
        )}
      </ToggleRow>
    </SettingsSection>
  );
}

function OrganizationBraidsList({
  failed,
  rows,
  paused,
}: {
  failed: boolean;
  rows: ReturnType<typeof organizationBraidRows>;
  paused: boolean;
}) {
  if (failed) return <SectionErrorNotice title="Couldn't load your organisation's braids" />;
  if (rows.length > 0) return <OrganizationBraidsTable rows={rows} paused={paused} />;
  return (
    <NoDataInfoBlock
      size="inline"
      icon={<FeatureMark feature="braids" size={24} variant="mono" />}
      title="No braids yet"
      description="When a project braids its spans into another, the braid is listed here."
      docsHref={BRAIDS_GUIDE_HREF}
    />
  );
}

export default function OrganizationBraidsScreen() {
  const host = useAuthzHost();
  const { organizationId } = host.scope();
  const { isEnterprise, isLoading: isPlanLoading } = host.plan();
  // Unreleased, the page lists existing braids, and offers the switch only to turn Braids off.
  const releasedFlag = useBraidsReleased();
  const released = releasedFlag === true;
  const braids = useOrganizationBraids({ organizationId });
  const policy = useBraidsPolicy({ organizationId });
  const saves = useSetBraidsSettings({ organizationId: organizationId ?? "" });

  if (!organizationId || isPlanLoading || releasedFlag === undefined || braids.isLoading) {
    return (
      <>
        <OrganizationBraidsHeader />
        <Stack gap={4} data-testid="organization-braids-loading">
          <Skeleton height="72px" borderRadius="md" />
          <Skeleton height="160px" borderRadius="md" />
        </Stack>
      </>
    );
  }

  const rows = organizationBraidRows({
    braids: braids.data ?? [],
    projects: host.organizationStructure().projects,
  });
  // Known off, never assumed: the setting pauses braids on Enterprise, released or not.
  const { byPlan: paused, byOrganization: turnedOff } = braidsPauses({
    planState: braidsPlanState({ isEnterprise, braidCount: rows.length }),
    turnedOff: policy.data?.braidsEnabled === false,
  });
  // Unread means never read: a failed refresh keeps the value already held.
  const unread = policy.isError && !policy.data;
  const stale = policy.isError && !!policy.data;
  // Unreleased, the row shows only to turn Braids off, or to say the setting couldn't be read.
  const showsSwitchRow = released || policy.data?.braidsEnabled === true || unread;

  return (
    <>
      <OrganizationBraidsHeader locked={!isEnterprise && (released || paused)} />
      <Stack gap={0} css={NO_RULE_UNDER_HEADER}>
        {released ? null : (
          <Box paddingBottom={4}>
            <BraidsNotEnabledBanner
              removeHere={false}
              status={braidsStatus({
                byOrganization: turnedOff,
                byPlan: paused,
                settingRead: policy.data !== undefined,
              })}
            />
          </Box>
        )}
        {paused ? (
          <Box paddingBottom={4}>
            <BraidsPlanPausedBanner
              kept="They are"
              isSingleBraid={false}
              turnedOn={policy.data?.braidsEnabled}
            />
          </Box>
        ) : null}
        {showsSwitchRow ? (
          <EnableBraids
            isEnterprise={isEnterprise}
            enabled={policy.data?.braidsEnabled ?? false}
            isReading={policy.isLoading}
            unread={unread}
            stale={stale}
            isSaving={saves.isSaving}
            onChange={saves.setEnabled}
            onRetry={() => void policy.refetch()}
          />
        ) : null}
        {released ? (
          <WhoMayBraid
            isEnterprise={isEnterprise}
            keptToAdmins={policy.data?.braidsOrganizationAdminsOnly ?? false}
            isReading={policy.isLoading}
            isSaving={saves.isSaving}
            onChange={saves.setKeptToAdmins}
          />
        ) : null}
        <SettingsSection
          title="Braids in this organisation"
          hint="Each braid shows a project's matching spans inside another project's traces."
          data-testid="organization-braids"
        >
          <OrganizationBraidsList
            failed={braids.isError}
            rows={rows}
            paused={paused || turnedOff}
          />
        </SettingsSection>
      </Stack>
    </>
  );
}
