/**
 * A project's Braids page: what flows out, what flows in and its signing keys, with what the
 * viewer may do following their permissions, the organisation setting and the plan.
 * Spec: modules/authz/specs/braids-screen.feature (design: dev/docs/plans/braids/).
 */

import { SIGNING_KEY_QUERY_KEY } from "@langwatch/api-key-client";
import { Link } from "@langwatch/browser-host/link";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Badge, Box, Button, Skeleton, Stack, Text } from "@langwatch/design-system/primitives";
import { SettingsSection } from "@langwatch/design-system/settings-section";
import { Plus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import {
  useBraidActivity,
  useBraidsReleased,
  useBraidsSettings,
  useProjectBraids,
  useRemoveBraid,
} from "../../../behavior/use-braids.ts";
import { AUTHZ_MANAGE_PERMISSION, useAuthzHost } from "../../../model/authz-host.ts";
import {
  type BraidAffordances,
  type BraidRow,
  BRAIDS_SECTION_QUERY_KEY,
  type BraidsPlanState,
  type BraidsSection,
  braidAffordances,
  braidsPauses,
  braidsPlanState,
  braidsStatus,
  braidsSectionOf,
  ORGANIZATION_BRAIDS_HREF,
  projectBraidRows,
} from "../../../model/braids/braids.ts";
import { BraidsEnterpriseUpsell } from "../../blocks/braids/braids-enterprise-upsell.tsx";
import { BraidsHowItWorks } from "../../blocks/braids/braids-how-it-works.tsx";
import { BraidsTable } from "../../blocks/braids/braids-table.tsx";
import { RemoveBraidDialog } from "../../blocks/braids/remove-braid-dialog.tsx";
import { BraidsNotEnabledBanner } from "../../elements/braids-not-enabled-banner.tsx";
import { BraidsPageLinks } from "../../elements/braids-page-links.tsx";
import { BraidsPlanPausedBanner } from "../../elements/braids-plan-paused-banner.tsx";
import { BraidsTitle } from "../../elements/braids-title.tsx";
import { NO_RULE_UNDER_HEADER } from "../../elements/no-rule-under-header.ts";
import { SectionErrorNotice } from "../../elements/section-error-notice.tsx";
import { BraidDialog } from "./braid-dialog.tsx";
import { BraidsSigningKeys } from "./braids-signing-keys.tsx";

const BRAIDS_MANAGE_PERMISSION = "braids:manage";
/** The braid dialog is URL-routed: `?braid=new`, or `?braid=<id>` for Edit. */
const BRAID_QUERY_KEY = "braid";

/** Where `?section=` scrolls to. */
const SECTION_ANCHORS: Record<BraidsSection, string> = {
  into: "braids-shown-elsewhere",
  from: "braids-shown-here",
  keys: "braids-signing-keys",
};

function NewBraidButton({ onOpen }: { onOpen: () => void }) {
  return (
    <PageLayout.HeaderButton primary onClick={onOpen} data-testid="new-braid-header">
      <Plus size={14} aria-hidden />
      New braid
    </PageLayout.HeaderButton>
  );
}

function BraidsHeader({
  actions,
  projectName,
  links,
  locked = false,
}: {
  actions?: ReactNode;
  /** The project the page is about. */
  projectName?: string;
  /** The quiet link line under the description. */
  links?: ReactNode;
  /** The plan locks Braids: the title shows a lock, as the settings menu does. */
  locked?: boolean;
}) {
  const switcher = useAuthzHost().projectSwitcher();
  const sentence = projectName
    ? `Show ${projectName}'s spans inside another project's traces. Nothing is copied.`
    : "Show spans from one project inside another project's traces. Nothing is copied.";
  return (
    <PageLayout.Header
      actions={
        switcher || actions ? (
          <>
            {switcher}
            {actions}
          </>
        ) : undefined
      }
      description={
        links ? (
          <>
            {sentence}
            {links}
          </>
        ) : (
          sentence
        )
      }
    >
      <BraidsTitle locked={locked} />
    </PageLayout.Header>
  );
}

function LoadingBraids() {
  return (
    <>
      <BraidsHeader />
      <Stack gap={4} data-testid="braids-loading">
        <Skeleton height="32px" width="420px" />
        <Skeleton height="160px" borderRadius="md" />
      </Stack>
    </>
  );
}

/** One direction of braids: its rows, or one muted line when there are none. */
function BraidsSectionBand({
  side,
  title,
  hint,
  count,
  none,
  children,
}: {
  side: "into" | "from";
  title: string;
  hint: string;
  count: number;
  none: string;
  children: ReactNode;
}) {
  return (
    <SettingsSection
      title={title}
      hint={hint}
      anchorId={SECTION_ANCHORS[side]}
      badge={
        <Badge size="sm" variant="subtle" data-testid={`braids-count-${side}`}>
          {count}
        </Badge>
      }
      data-testid={`braids-section-${side}`}
    >
      {count > 0 ? (
        children
      ) : (
        <Text textStyle="sm" color="fg.muted" data-testid={`braids-none-${side}`}>
          {none}
        </Text>
      )}
    </SettingsSection>
  );
}

/** The organisation has Braids turned off: who can turn it on, and what happened to the braids. */
function TurnedOffBanner({
  total,
  isOrganizationAdmin,
}: {
  total: number;
  isOrganizationAdmin: boolean;
}) {
  const kept =
    total === 0
      ? "New braids can be made once it is on."
      : `${total === 1 ? "This project's braid is" : `This project's ${total} braids are`} paused and kept, and start working again when it is on.`;
  return (
    <Banner
      status="info"
      title="Braids is off for your organisation"
      data-testid="braids-turned-off"
      action={
        isOrganizationAdmin ? (
          <BannerAction asChild>
            <Link href={ORGANIZATION_BRAIDS_HREF}>Turn on Braids</Link>
          </BannerAction>
        ) : undefined
      }
    >
      {kept}{" "}
      {isOrganizationAdmin
        ? "You can turn it on in the organisation's Braids settings."
        : "Ask an organisation admin to turn it on."}
    </Banner>
  );
}

function KeptToAdminsBanner() {
  return (
    <Banner
      status="info"
      title="Your organisation's admins manage braids"
      action={
        <BannerAction asChild>
          <Link href="/settings/directory">Ask an admin</Link>
        </BannerAction>
      }
    >
      Your organisation keeps braids to its admins, so only they can create, change or remove them.
    </Banner>
  );
}

/** Not-enabled, turned-off, paused and kept-to-admins notices, above the sections. */
function BraidsNotices({
  released,
  turnedOff,
  turnedOn,
  paused,
  total,
  keptToAdmins,
  isOrganizationAdmin,
}: {
  released: boolean;
  turnedOff: boolean;
  /** Known on; undefined while the setting is unread. */
  turnedOn: boolean | undefined;
  paused: boolean;
  total: number;
  keptToAdmins: boolean;
  isOrganizationAdmin: boolean;
}) {
  if (released && !turnedOff && !paused && !keptToAdmins) return null;
  return (
    <Stack gap={4} paddingBottom={4}>
      {released ? null : (
        <BraidsNotEnabledBanner
          removeHere
          status={braidsStatus({
            byOrganization: turnedOff,
            byPlan: paused,
            settingRead: turnedOn !== undefined,
          })}
        />
      )}
      {released && turnedOff ? (
        <TurnedOffBanner total={total} isOrganizationAdmin={isOrganizationAdmin} />
      ) : null}
      {paused ? (
        <BraidsPlanPausedBanner
          kept={total === 1 ? "Your braid is" : `Your ${total} braids are`}
          isSingleBraid={total === 1}
          turnedOn={turnedOn}
        />
      ) : null}
      {keptToAdmins ? <KeptToAdminsBanner /> : null}
    </Stack>
  );
}

/** The api-key module's panel, under its own heading; New signing key for whoever manages keys. */
function SigningKeysBand({
  projectId,
  planState,
  canIssue,
  onNewKey,
}: {
  projectId: string;
  planState: BraidsPlanState;
  canIssue: boolean;
  onNewKey: (() => void) | undefined;
}) {
  return (
    <SettingsSection
      title="Signing keys"
      anchorId={SECTION_ANCHORS.keys}
      actions={
        onNewKey ? (
          <Button size="sm" variant="outline" onClick={onNewKey} data-testid="new-signing-key">
            <Plus size={14} aria-hidden />
            New signing key
          </Button>
        ) : undefined
      }
      data-testid="braids-section-keys"
    >
      <BraidsSigningKeys projectId={projectId} planState={planState} canIssue={canIssue} />
    </SettingsSection>
  );
}

/** Who may change braids: one muted footnote at the end of the page. */
function WhoMayBraidHint({ keptToAdmins }: { keptToAdmins: boolean }) {
  return (
    <Text
      textStyle="caption"
      color="fg.muted"
      paddingTop={6}
      borderTopWidth="1px"
      borderColor="border.subtle"
      marginTop={2}
      data-testid="braids-who-may-braid"
    >
      {keptToAdmins
        ? "Organisation admins can create, change or remove braids. Every change is in the audit log."
        : "Admins of this project and organisation admins can create, change or remove braids. Every change is in the audit log."}
    </Text>
  );
}

export default function BraidsScreen() {
  const host = useAuthzHost();
  const { organizationId, projectId } = host.scope();
  const { isEnterprise, isLoading: isPlanLoading } = host.plan();
  // Off, the page lists existing braids read-only with Remove (Alex, 2026-11-18).
  const releasedFlag = useBraidsReleased();
  const released = releasedFlag === true;
  const braids = useProjectBraids({ projectId });
  const { keptToAdmins, turnedOff, turnedOn } = useBraidsSettings({ organizationId });
  const [removing, setRemoving] = useState<BraidRow | null>(null);
  const removal = useRemoveBraid({ onRemoved: () => setRemoving(null) });
  const activity = useBraidActivity({
    projectId,
    braids: braids.data,
    enabled: isEnterprise && released && !turnedOff,
  });
  const { query } = host.route();
  const openBraid = (braid: string | undefined) =>
    host.setQuery({ ...query, [BRAID_QUERY_KEY]: braid });
  // `?section=` lands a link on one section, Signing keys most often, once its rows are in.
  const section = braidsSectionOf(query[BRAIDS_SECTION_QUERY_KEY]);
  const loaded = !!projectId && !isPlanLoading && !!braids.data;
  useEffect(() => {
    if (!section || !loaded) return;
    document.getElementById(SECTION_ANCHORS[section])?.scrollIntoView({ block: "start" });
  }, [section, loaded]);

  if (!projectId || isPlanLoading || releasedFlag === undefined || braids.isLoading) {
    return <LoadingBraids />;
  }
  if (braids.isError || !braids.data) {
    return (
      <>
        <BraidsHeader />
        <Box>
          <SectionErrorNotice title="Couldn't load this project's braids" />
        </Box>
      </>
    );
  }

  const { projects } = host.organizationStructure();
  const projectName = projects.find((project) => project.id === projectId)?.name ?? "This project";
  const rows = projectBraidRows({ braids: braids.data, projects });
  const planState = braidsPlanState({
    isEnterprise,
    braidCount: rows.into.length + rows.from.length,
  });
  if (planState === "upsell" && released) {
    return (
      <>
        <BraidsHeader projectName={projectName} locked />
        <Box>
          <BraidsEnterpriseUpsell />
        </Box>
      </>
    );
  }

  const can: BraidAffordances = braidAffordances({
    canManage: host.hasPermission(BRAIDS_MANAGE_PERMISSION),
    planState,
    keptToOrganizationAdmins: keptToAdmins,
    released,
    turnedOn: !turnedOff,
  });
  const pauses = braidsPauses({ planState, turnedOff });
  const paused = pauses.byPlan;
  const pausedByOrganization = pauses.byOrganization;
  const seesOrganization = host.hasPermission(AUTHZ_MANAGE_PERMISSION);
  const total = rows.into.length + rows.from.length;
  const table = (side: "into" | "from") => (
    <BraidsTable
      side={side}
      projectName={projectName}
      rows={side === "into" ? rows.into : rows.from}
      paused={paused || pausedByOrganization}
      canEdit={can.canEditInto}
      canRemove={can.canRemove}
      activity={activity}
      onEdit={(row) => openBraid(row.braidId)}
      onRemove={setRemoving}
    />
  );

  const asked = query[BRAID_QUERY_KEY];
  const editing = braids.data.intoOtherProjects.find((braid) => braid.braidId === asked);
  const dialogOpen = (asked === "new" && can.canCreate) || (!!editing && can.canEditInto);

  return (
    <>
      <BraidsHeader
        projectName={projectName}
        locked={paused}
        actions={can.canCreate ? <NewBraidButton onOpen={() => openBraid("new")} /> : undefined}
        links={
          <BraidsPageLinks
            organization={
              seesOrganization ? { name: host.organizationStructure().organizationName } : undefined
            }
          />
        }
      />
      <Stack gap={0} css={NO_RULE_UNDER_HEADER}>
        <BraidsNotices
          released={released}
          turnedOff={pausedByOrganization}
          turnedOn={turnedOn}
          paused={paused}
          total={total}
          keptToAdmins={can.showKeptToAdminsNote}
          isOrganizationAdmin={seesOrganization}
        />
        {total === 0 && released ? (
          <Box paddingBottom={6}>
            <BraidsHowItWorks projectName={projectName} />
          </Box>
        ) : (
          <>
            <BraidsSectionBand
              side="into"
              title="Shown in other projects"
              hint={`Projects that show ${projectName}'s matching spans in their traces.`}
              count={rows.into.length}
              none={`${projectName} doesn't show its spans in any other project yet.`}
            >
              {table("into")}
            </BraidsSectionBand>
            <BraidsSectionBand
              side="from"
              title="Shown here from other projects"
              hint={`Projects whose matching spans show in ${projectName}'s traces.`}
              count={rows.from.length}
              none={`No project shows its spans in ${projectName} yet.`}
            >
              {table("from")}
            </BraidsSectionBand>
          </>
        )}
        {/* Off, keys list with Revoke only: a leaked key still verifies (Alex, 2026-11-18). */}
        <SigningKeysBand
          projectId={projectId}
          planState={planState}
          canIssue={released && !pausedByOrganization}
          onNewKey={
            can.canCreate
              ? () => host.setQuery({ ...query, [SIGNING_KEY_QUERY_KEY]: "new" })
              : undefined
          }
        />
        {released ? <WhoMayBraidHint keptToAdmins={keptToAdmins} /> : null}
      </Stack>
      {dialogOpen ? (
        <BraidDialog
          key={asked}
          projectId={projectId}
          editing={editing}
          braidsInto={braids.data.intoOtherProjects}
          keptToAdmins={keptToAdmins}
          onClose={() => openBraid(undefined)}
        />
      ) : null}
      <RemoveBraidDialog
        row={removing}
        projectName={projectName}
        isRemoving={removal.isRemoving}
        onClose={() => setRemoving(null)}
        onConfirm={(row) => removal.remove({ projectId, braidId: row.braidId })}
      />
    </>
  );
}
