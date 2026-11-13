/**
 * A project's Braids page: what flows out, what flows in and its signing keys, with what the
 * viewer may do following their permissions, the organisation setting and the plan.
 * Spec: modules/authz/specs/braids-screen.feature (design: dev/docs/plans/braids/).
 */

import { Link } from "@langwatch/browser-host/link";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, Button, Skeleton, Stack, Text } from "@langwatch/design-system/primitives";
import { ArrowRight, BookOpen, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";

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
  BRAIDS_GUIDE_HREF,
  BRAIDS_TAB_QUERY_KEY,
  type BraidsTab,
  braidAffordances,
  braidsPlanState,
  braidsTabOf,
  projectBraidRows,
} from "../../../model/braids/braids.ts";
import { BraidsEnterpriseUpsell } from "../../blocks/braids/braids-enterprise-upsell.tsx";
import { BraidsHowItWorks } from "../../blocks/braids/braids-how-it-works.tsx";
import { BraidsTable } from "../../blocks/braids/braids-table.tsx";
import { RemoveBraidDialog } from "../../blocks/braids/remove-braid-dialog.tsx";
import { BraidsTitle } from "../../elements/braids-title.tsx";
import { SectionErrorNotice } from "../../elements/section-error-notice.tsx";
import { BraidDialog } from "./braid-dialog.tsx";
import { BraidsSigningKeys } from "./braids-signing-keys.tsx";

const BRAIDS_MANAGE_PERMISSION = "braids:manage";
const ORGANIZATION_BRAIDS_HREF = "/settings/organization-braids";
/** The api-key panel opens New signing key on `?signingKey=new`, as Edit opens on `?braid=`. */
const SIGNING_KEY_QUERY_KEY = "signingKey";

/** The braid dialog is URL-routed: `?braid=new`, or `?braid=<id>` for Edit. */
const BRAID_QUERY_KEY = "braid";

function NewBraidButton({ onOpen }: { onOpen: () => void }) {
  return (
    <PageLayout.HeaderButton primary onClick={onOpen} data-testid="new-braid-header">
      <Plus size={14} aria-hidden />
      New braid
    </PageLayout.HeaderButton>
  );
}

/** Signing keys' primary action, outlined; the panel opens its create dialog from the query. */
function NewSigningKeyButton({ onOpen }: { onOpen: () => void }) {
  return (
    <PageLayout.HeaderButton onClick={onOpen} data-testid="new-signing-key-header">
      <Plus size={14} aria-hidden />
      New signing key
    </PageLayout.HeaderButton>
  );
}

function GuideLink() {
  return (
    <PageLayout.HeaderButton asChild>
      <Link href={BRAIDS_GUIDE_HREF} isExternal>
        <BookOpen size={14} aria-hidden />
        How braids work
      </Link>
    </PageLayout.HeaderButton>
  );
}

function BraidsHeader({
  actions,
  projectName,
  locked = false,
}: {
  actions?: ReactNode;
  /** The project the page is about; the organisation screen names none. */
  projectName?: string;
  /** The plan locks Braids: the title shows a lock, as the settings menu does. */
  locked?: boolean;
}) {
  const switcher = useAuthzHost().projectSwitcher();
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
        projectName
          ? `Show ${projectName}'s spans inside another project's traces. Nothing is copied.`
          : "Show spans from one project inside another project's traces. Nothing is copied."
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
      <Stack gap={4} paddingTop={4} data-testid="braids-loading">
        <Skeleton height="32px" width="420px" />
        <Skeleton height="160px" borderRadius="md" />
      </Stack>
    </>
  );
}

function NothingBraidedIn({ projectName }: { projectName: string }) {
  return (
    <NoDataInfoBlock
      icon={<FeatureMark feature="braids" size={24} variant="mono" />}
      title="Nothing braided in"
      description={`When another project braids its spans into ${projectName}, they show in its traces and are listed here.`}
      docsHref={BRAIDS_GUIDE_HREF}
      testId="braids-empty-from"
    />
  );
}

/** Paused, an empty tab points at the tab that holds this project's braids, in one line. */
function BraidsOnOtherTab({ tab, onOpen }: { tab: "into" | "from"; onOpen: () => void }) {
  return (
    <Text textStyle="sm" color="fg.muted" paddingY={3} data-testid="braids-on-other-tab">
      {"Nothing here. This project's braids are under "}
      <Button variant="plain" size="sm" height="auto" padding={0} onClick={onOpen}>
        {tab === "into" ? "Into other projects" : "From other projects"}
      </Button>
      .
    </Text>
  );
}

function BraidsHeaderActions({
  tab,
  canCreate,
  canManageKeys,
  organizationLink,
  onNewBraid,
  onNewKey,
}: {
  tab: BraidsTab;
  canCreate: boolean;
  canManageKeys: boolean;
  /** The organisation's braids link; absent for whoever cannot open that view. */
  organizationLink: ReactNode;
  onNewBraid: () => void;
  onNewKey: () => void;
}) {
  // The header's main action follows the tab.
  const action =
    tab === "keys"
      ? canManageKeys && <NewSigningKeyButton onOpen={onNewKey} />
      : canCreate && <NewBraidButton onOpen={onNewBraid} />;
  return (
    <>
      {organizationLink}
      <GuideLink />
      {action || null}
    </>
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

/** An empty tab: paused with the braids on the other tab, a pointer there; else its empty state. */
function EmptyTab({
  side,
  paused,
  otherCount,
  onOpen,
  children,
}: {
  side: "into" | "from";
  paused: boolean;
  otherCount: number;
  onOpen: (tab: "into" | "from") => void;
  children: ReactNode;
}) {
  const other = side === "into" ? "from" : "into";
  if (paused && otherCount > 0)
    return <BraidsOnOtherTab tab={other} onOpen={() => onOpen(other)} />;
  return children;
}

/** The organisation's view of every braid, a secondary header link for whoever may open it. */
function OrganizationBraidsLink({ organizationName }: { organizationName: string | undefined }) {
  return (
    <PageLayout.HeaderButton asChild>
      <Link href={ORGANIZATION_BRAIDS_HREF} data-testid="braids-organization-link">
        {organizationName ? `All braids in ${organizationName}` : "All braids in your organisation"}
        <ArrowRight size={14} aria-hidden />
      </Link>
    </PageLayout.HeaderButton>
  );
}

function WhoMayBraidHint({ keptToAdmins }: { keptToAdmins: boolean }) {
  return (
    <Text textStyle="sm" color="fg.muted" paddingTop={3}>
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
  // The URL names the tab, so a link can open Signing keys; a pick shows at once and is written
  // back, and a URL that changes after it wins.
  const urlTab = braidsTabOf(query[BRAIDS_TAB_QUERY_KEY]);
  const [picked, setPicked] = useState<{ from: BraidsTab; tab: BraidsTab }>();
  const tab = picked?.from === urlTab ? picked.tab : urlTab;
  const setTab = (next: BraidsTab) => {
    setPicked({ from: urlTab, tab: next });
    host.setQuery(
      { ...query, [BRAIDS_TAB_QUERY_KEY]: next === "into" ? undefined : next },
      { replace: true },
    );
  };

  if (!projectId || isPlanLoading || braids.isLoading) return <LoadingBraids />;
  if (braids.isError || !braids.data) {
    return (
      <>
        <BraidsHeader />
        <Box paddingTop={4}>
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
        <Box paddingTop={4}>
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
  const emptyTab = (side: "into" | "from", empty: ReactNode) => (
    <EmptyTab
      side={side}
      paused={paused}
      otherCount={side === "into" ? rows.from.length : rows.into.length}
      onOpen={setTab}
    >
      {empty}
    </EmptyTab>
  );
  const total = rows.into.length + rows.from.length;
  const table = (side: "into" | "from") => (
    <>
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
      <WhoMayBraidHint keptToAdmins={keptToAdmins} />
    </>
  );

  const asked = query[BRAID_QUERY_KEY];
  const editing = braids.data.intoOtherProjects.find((braid) => braid.braidId === asked);
  const dialogOpen = (asked === "new" && can.canCreate) || (!!editing && can.canEditInto);

  return (
    <>
      <BraidsHeader
        projectName={projectName}
        locked={paused}
        actions={
          <BraidsHeaderActions
            tab={tab}
            canCreate={can.canCreate}
            canManageKeys={canManageKeys}
            organizationLink={
              seesOrganization ? (
                <OrganizationBraidsLink
                  organizationName={host.organizationStructure().organizationName}
                />
              ) : null
            }
            onNewBraid={() => openBraid("new")}
            onNewKey={() => host.setQuery({ ...query, [SIGNING_KEY_QUERY_KEY]: "new" })}
          />
        }
      />
      <Stack gap={4} paddingTop={paused || can.showKeptToAdminsNote ? 4 : 0}>
        {paused ? <PausedBanner total={total} /> : null}
        {can.showKeptToAdminsNote ? <KeptToAdminsBanner /> : null}
        {/* Only the open tab is mounted: the others hold no read open behind it. */}
        <ContentTabs
          label="Braids"
          value={tab}
          onValueChange={({ value }) => setTab(value)}
          mount="active"
          body="flush"
          items={[
            {
              value: "into",
              label: "Into other projects",
              count: rows.into.length,
              testId: "braids-tab-into",
              content: (
                <Box paddingTop={4}>
                  {rows.into.length > 0
                    ? table("into")
                    : emptyTab("into", <BraidsHowItWorks projectName={projectName} />)}
                </Box>
              ),
            },
            {
              value: "from",
              label: "From other projects",
              count: rows.from.length,
              testId: "braids-tab-from",
              content: (
                <Box paddingTop={4}>
                  {rows.from.length > 0
                    ? table("from")
                    : emptyTab("from", <NothingBraidedIn projectName={projectName} />)}
                </Box>
              ),
            },
            {
              value: "keys",
              label: "Signing keys",
              testId: "braids-tab-keys",
              content: (
                <Box paddingTop={4}>
                  <BraidsSigningKeys projectId={projectId} planState={planState} />
                </Box>
              ),
            },
          ]}
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
