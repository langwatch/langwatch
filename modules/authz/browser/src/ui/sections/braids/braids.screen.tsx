/**
 * A project's Braids page: what flows out, what flows in and its signing keys, with what the
 * viewer may do following their permissions, the organisation setting and the plan.
 * Spec: modules/authz/specs/braids-screen.feature (design: dev/docs/plans/braids/).
 */

import { Link } from "@langwatch/browser-host/link";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Badge, Box, Button, Skeleton, Stack, Text } from "@langwatch/design-system/primitives";
import { SettingsSection } from "@langwatch/design-system/settings-section";
import { Plus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import {
  useBraidActivity,
  useBraidsPolicy,
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
  braidsPlanState,
  braidsSectionOf,
  projectBraidRows,
} from "../../../model/braids/braids.ts";
import { BraidsEnterpriseUpsell } from "../../blocks/braids/braids-enterprise-upsell.tsx";
import { BraidsHowItWorks } from "../../blocks/braids/braids-how-it-works.tsx";
import { BraidsTable } from "../../blocks/braids/braids-table.tsx";
import { RemoveBraidDialog } from "../../blocks/braids/remove-braid-dialog.tsx";
import { BraidsPageLinks } from "../../elements/braids-page-links.tsx";
import { BraidsTitle } from "../../elements/braids-title.tsx";
import { SectionErrorNotice } from "../../elements/section-error-notice.tsx";
import { BraidDialog } from "./braid-dialog.tsx";
import { BraidsSigningKeys } from "./braids-signing-keys.tsx";

const BRAIDS_MANAGE_PERMISSION = "braids:manage";
/** The api-key panel opens New signing key on `?signingKey=new`, as Edit opens on `?braid=`. */
const SIGNING_KEY_QUERY_KEY = "signingKey";

/** The braid dialog is URL-routed: `?braid=new`, or `?braid=<id>` for Edit. */
const BRAID_QUERY_KEY = "braid";

/** The header already ends on a rule: a band that opens the body draws none of its own. */
const NO_RULE_UNDER_HEADER = { "& > section:first-child": { borderTopWidth: 0, paddingTop: 0 } };

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
  footnote,
  children,
}: {
  side: "into" | "from";
  title: string;
  hint: string;
  count: number;
  none: string;
  /** Under the rows or the empty line. */
  footnote?: ReactNode;
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
      {footnote}
    </SettingsSection>
  );
}

function PausedBanner({ total }: { total: number }) {
  return (
    <Banner
      status="warning"
      title="Braids are paused"
      action={
        <BannerAction asChild>
          <Link href="/settings/plans">See plans</Link>
        </BannerAction>
      }
    >
      Braids need the Enterprise plan. Your {total === 1 ? "braid is" : `${total} braids are`} kept
      and start working again when you upgrade.
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

/** Paused and kept-to-admins notices, above the sections. */
function BraidsNotices({
  paused,
  total,
  keptToAdmins,
}: {
  paused: boolean;
  total: number;
  keptToAdmins: boolean;
}) {
  if (!paused && !keptToAdmins) return null;
  return (
    <Stack gap={4} paddingBottom={4}>
      {paused ? <PausedBanner total={total} /> : null}
      {keptToAdmins ? <KeptToAdminsBanner /> : null}
    </Stack>
  );
}

/** The api-key module's panel, under its own heading; New signing key for whoever manages keys. */
function SigningKeysBand({
  projectId,
  planState,
  onNewKey,
}: {
  projectId: string;
  planState: BraidsPlanState;
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
      <BraidsSigningKeys projectId={projectId} planState={planState} />
    </SettingsSection>
  );
}

function WhoMayBraidHint({ keptToAdmins }: { keptToAdmins: boolean }) {
  return (
    <Text textStyle="sm" color="fg.muted">
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
  const braids = useProjectBraids({ projectId });
  const policy = useBraidsPolicy({ organizationId });
  const [removing, setRemoving] = useState<BraidRow | null>(null);
  const removal = useRemoveBraid({ onRemoved: () => setRemoving(null) });
  const activity = useBraidActivity({ projectId, braids: braids.data });
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

  if (!projectId || isPlanLoading || braids.isLoading) return <LoadingBraids />;
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
  if (planState === "upsell") {
    return (
      <>
        <BraidsHeader projectName={projectName} locked />
        <Box>
          <BraidsEnterpriseUpsell />
        </Box>
      </>
    );
  }

  const keptToAdmins = policy.data?.braidsOrganizationAdminsOnly ?? false;
  const can: BraidAffordances = braidAffordances({
    canManage: host.hasPermission(BRAIDS_MANAGE_PERMISSION),
    planState,
    keptToOrganizationAdmins: keptToAdmins,
  });
  const paused = planState === "paused";
  const canManageKeys = planState === "enterprise" && host.hasPermission(BRAIDS_MANAGE_PERMISSION);
  const seesOrganization = host.hasPermission(AUTHZ_MANAGE_PERMISSION);
  const total = rows.into.length + rows.from.length;
  const table = (side: "into" | "from") => (
    <BraidsTable
      side={side}
      projectName={projectName}
      rows={side === "into" ? rows.into : rows.from}
      paused={paused}
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
        <BraidsNotices paused={paused} total={total} keptToAdmins={can.showKeptToAdminsNote} />
        {total === 0 ? (
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
              footnote={<WhoMayBraidHint keptToAdmins={keptToAdmins} />}
            >
              {table("from")}
            </BraidsSectionBand>
          </>
        )}
        <SigningKeysBand
          projectId={projectId}
          planState={planState}
          onNewKey={
            canManageKeys
              ? () => host.setQuery({ ...query, [SIGNING_KEY_QUERY_KEY]: "new" })
              : undefined
          }
        />
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
