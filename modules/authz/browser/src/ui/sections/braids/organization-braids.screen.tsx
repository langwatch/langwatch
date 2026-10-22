/**
 * The organisation's Braids screen, for its admins: who may braid (the setting) and every live
 * braid in the organisation. Below Enterprise the setting shows the upsell, never a dead switch.
 * Spec: modules/authz/specs/braids-screen.feature, "An organisation admin chooses who may braid".
 */

import { Link } from "@langwatch/browser-host/link";
import { Banner } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Button, HStack, Skeleton, Stack, Text } from "@langwatch/design-system/primitives";
import { SettingsCard } from "@langwatch/design-system/settings-card";
import { Switch } from "@langwatch/design-system/switch";

import {
  useBraidsPolicy,
  useOrganizationBraids,
  useSetBraidsPolicy,
} from "../../../behavior/use-braids.ts";
import { useAuthzHost } from "../../../model/authz-host.ts";
import { BRAIDS_GUIDE_HREF, organizationBraidRows } from "../../../model/braids/braids.ts";
import { OrganizationBraidsTable } from "../../blocks/braids/organization-braids-table.tsx";
import { BraidsEnterprisePill } from "../../elements/braids-enterprise-pill.tsx";
import { SectionErrorNotice } from "../../elements/section-error-notice.tsx";

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
      <HStack gap={2}>
        <FeatureMark feature="braids" size={22} />
        <PageLayout.Heading>Braids</PageLayout.Heading>
        <BraidsEnterprisePill />
      </HStack>
    </PageLayout.Header>
  );
}

const SETTING_HINT =
  "While this is off, project admins can braid their projects. Turn it on and only organisation admins can create, change or remove braids.";

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
  if (!isEnterprise) {
    return (
      <SettingsCard
        title="Who may braid"
        hint={SETTING_HINT}
        data-testid="braids-policy-upsell"
        actions={
          <HStack gap={3}>
            <Text fontSize="sm" color="fg.muted">
              Choosing who may braid is included in Enterprise.
            </Text>
            <Button asChild colorPalette="orange" size="xs">
              <Link href="/settings/plans">See plans</Link>
            </Button>
          </HStack>
        }
      />
    );
  }
  return (
    <SettingsCard title="Who may braid" hint={SETTING_HINT}>
      <Switch
        checked={keptToAdmins}
        disabled={isReading || setting.isSaving}
        onCheckedChange={({ checked }) => setting.set(checked)}
        data-testid="braids-policy-switch"
      >
        Keep braids to organisation admins
      </Switch>
    </SettingsCard>
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
          <Skeleton height="96px" borderRadius="xl" />
          <Skeleton height="220px" borderRadius="xl" />
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
      <Stack gap={6}>
        {paused ? (
          <Banner status="warning" title="Braids are paused">
            Braids need the Enterprise plan. They are kept and start working again when you upgrade.
          </Banner>
        ) : null}
        <WhoMayBraid
          organizationId={organizationId}
          isEnterprise={isEnterprise}
          keptToAdmins={policy.data?.braidsOrganizationAdminsOnly ?? false}
          isReading={policy.isLoading}
        />
        {braids.isError ? (
          <SectionErrorNotice title="Couldn't load your organisation's braids" />
        ) : (
          <Card
            title="Braids in this organisation"
            description="Each braid shows a project's matching spans inside another project's traces."
            padding={rows.length > 0 ? "none" : "md"}
            data-testid="organization-braids"
          >
            {rows.length > 0 ? (
              <OrganizationBraidsTable rows={rows} paused={paused} />
            ) : (
              <Text color="fg.muted">No project braids its spans into another project yet.</Text>
            )}
          </Card>
        )}
      </Stack>
    </>
  );
}
