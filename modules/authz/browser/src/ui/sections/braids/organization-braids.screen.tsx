/**
 * The organisation's Braids screen, for its admins: who may braid (the setting) and every live
 * braid in the organisation. Below Enterprise the setting shows the upsell, never a dead switch.
 * Spec: modules/authz/specs/braids-screen.feature, "An organisation admin chooses who may braid".
 */

import { Link } from "@langwatch/browser-host/link";
import { Banner } from "@langwatch/design-system/banner";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, Button, Skeleton, Stack } from "@langwatch/design-system/primitives";
import { SettingsField } from "@langwatch/design-system/settings-field";
import { SettingsSection } from "@langwatch/design-system/settings-section";
import { Switch } from "@langwatch/design-system/switch";
import { ShieldCheck, Waypoints } from "lucide-react";

import {
  useBraidsPolicy,
  useOrganizationBraids,
  useSetBraidsPolicy,
} from "../../../behavior/use-braids.ts";
import { useAuthzHost } from "../../../model/authz-host.ts";
import { BRAIDS_GUIDE_HREF, organizationBraidRows } from "../../../model/braids/braids.ts";
import { OrganizationBraidsTable } from "../../blocks/braids/organization-braids-table.tsx";
import { BraidsTitle } from "../../elements/braids-title.tsx";
import { SectionErrorNotice } from "../../elements/section-error-notice.tsx";

const KEEP_TO_ADMINS = "Keep braids to organisation admins";

function OrganizationBraidsHeader() {
  return (
    <PageLayout.Header
      description="Every braid in your organisation, and who may create, change or remove them."
      actions={
        <PageLayout.HeaderButton asChild>
          <Link href={BRAIDS_GUIDE_HREF} isExternal>
            How braids work
          </Link>
        </PageLayout.HeaderButton>
      }
    >
      <BraidsTitle />
    </PageLayout.Header>
  );
}

function WhoMayBraid({
  organizationId,
  isEnterprise,
  keptToAdmins,
  isReading,
}: {
  organizationId: string;
  isEnterprise: boolean;
  keptToAdmins: boolean;
  isReading: boolean;
}) {
  const setting = useSetBraidsPolicy({ organizationId });
  return (
    <SettingsSection
      icon={<ShieldCheck size={18} />}
      title="Who may braid"
      hint="Who can create, change or remove braids in this organisation's projects."
    >
      <SettingsField
        label={KEEP_TO_ADMINS}
        controlAlign="end"
        layout="inline"
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
            disabled={isReading || setting.isSaving}
            onCheckedChange={({ checked }) => setting.set(checked)}
            inputProps={{ "aria-label": KEEP_TO_ADMINS }}
            data-testid="braids-policy-switch"
          />
        ) : (
          <Button asChild colorPalette="orange" size="xs">
            <Link href="/settings/plans">See plans</Link>
          </Button>
        )}
      </SettingsField>
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
      icon={<Waypoints size={24} />}
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
  const braids = useOrganizationBraids({ organizationId });
  const policy = useBraidsPolicy({ organizationId });

  if (!organizationId || isPlanLoading || braids.isLoading) {
    return (
      <>
        <OrganizationBraidsHeader />
        <Stack gap={4} paddingTop={4} data-testid="organization-braids-loading">
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
  const paused = !isEnterprise && rows.length > 0;

  return (
    <>
      <OrganizationBraidsHeader />
      <Stack gap={0}>
        {paused ? (
          <Box paddingY={4}>
            <Banner status="warning" title="Braids are paused">
              Braids need the Enterprise plan. They are kept and start working again when you
              upgrade.
            </Banner>
          </Box>
        ) : null}
        <WhoMayBraid
          organizationId={organizationId}
          isEnterprise={isEnterprise}
          keptToAdmins={policy.data?.braidsOrganizationAdminsOnly ?? false}
          isReading={policy.isLoading}
        />
        <SettingsSection
          icon={<Waypoints size={18} />}
          title="Braids in this organisation"
          hint="Each braid shows a project's matching spans inside another project's traces."
          data-testid="organization-braids"
        >
          <OrganizationBraidsList failed={braids.isError} rows={rows} paused={paused} />
        </SettingsSection>
      </Stack>
    </>
  );
}
