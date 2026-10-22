/**
 * A project's Braids page: what flows out, what flows in and its signing keys, with what the
 * viewer may do following their permissions, the organisation setting and the plan.
 * Spec: modules/authz/specs/braids-screen.feature (design: dev/docs/plans/braids/).
 */

import { Link } from "@langwatch/browser-host/link";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { EnterprisePill } from "@langwatch/design-system/enterprise-pill";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { HStack, Skeleton, Stack, Text } from "@langwatch/design-system/primitives";
import { BookOpen, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  useBraidActivity,
  useBraidsPolicy,
  useProjectBraids,
  useRemoveBraid,
} from "../../../behavior/use-braids.ts";
import { useAuthzHost } from "../../../model/authz-host.ts";
import {
  type BraidAffordances,
  type BraidRow,
  BRAIDS_GUIDE_HREF,
  braidAffordances,
  braidsPlanState,
  projectBraidRows,
} from "../../../model/braids/braids.ts";
import { BraidsEnterpriseUpsell } from "../../blocks/braids/braids-enterprise-upsell.tsx";
import { BraidsHowItWorks } from "../../blocks/braids/braids-how-it-works.tsx";
import { BraidsTable } from "../../blocks/braids/braids-table.tsx";
import { RemoveBraidDialog } from "../../blocks/braids/remove-braid-dialog.tsx";
import { SectionErrorNotice } from "../../elements/section-error-notice.tsx";
import { BraidDrawer } from "./braid-drawer.tsx";
import { BraidsSigningKeys } from "./braids-signing-keys.tsx";

type BraidsTab = "into" | "from" | "keys";

export const BRAIDS_MANAGE_PERMISSION = "braids:manage";

/** The braid drawer is URL-routed: `?braid=new`, or `?braid=<id>` for Edit. */
const BRAID_QUERY_KEY = "braid";

function NewBraidButton({
  placement,
  onOpen,
}: {
  placement: "header" | "inline";
  onOpen: () => void;
}) {
  return (
    <PageLayout.HeaderButton primary onClick={onOpen} data-testid={`new-braid-${placement}`}>
      <Plus size={14} aria-hidden />
      New braid
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

export function BraidsHeader({
  actions,
  projectName,
}: {
  actions?: ReactNode;
  /** The project the page is about; the organisation screen names none. */
  projectName?: string;
}) {
  return (
    <PageLayout.Header
      actions={actions}
      description={
        projectName
          ? `Show ${projectName}'s spans inside another project's traces. Nothing is copied.`
          : "Show spans from one project inside another project's traces. Nothing is copied."
      }
    >
      <HStack gap={2}>
        <FeatureMark feature="braids" size={22} />
        <PageLayout.Heading>Braids</PageLayout.Heading>
        <EnterprisePill feature="braids" />
      </HStack>
    </PageLayout.Header>
  );
}

function LoadingBraids() {
  return (
    <>
      <BraidsHeader />
      <Stack gap={4} paddingTop={4} data-testid="braids-loading">
        <Skeleton height="32px" width="420px" />
        <Skeleton height="220px" borderRadius="xl" />
      </Stack>
    </>
  );
}

function EmptyLine({ children }: { children: string }) {
  return (
    <Stack align="center" gap={3} paddingY={10} color="fg.subtle" textAlign="center">
      <FeatureMark feature="braids" size={24} variant="mono" />
      <Text color="fg.muted">{children}</Text>
    </Stack>
  );
}

function WhoMayBraidHint({ keptToAdmins }: { keptToAdmins: boolean }) {
  return (
    <Text fontSize="sm" color="fg.muted" paddingTop={3}>
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
  const [tab, setTab] = useState<BraidsTab>("into");
  const [removing, setRemoving] = useState<BraidRow | null>(null);
  const removal = useRemoveBraid({ onRemoved: () => setRemoving(null) });
  const activity = useBraidActivity({ projectId, braids: braids.data });
  const { query } = host.route();
  const openBraid = (braid: string | undefined) =>
    host.setQuery({ ...query, [BRAID_QUERY_KEY]: braid });

  if (!projectId || isPlanLoading || braids.isLoading) return <LoadingBraids />;
  if (braids.isError || !braids.data) {
    return (
      <>
        <BraidsHeader />
        <SectionErrorNotice title="Couldn't load this project's braids" />
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
        <BraidsHeader actions={<GuideLink />} projectName={projectName} />
        <BraidsEnterpriseUpsell />
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
  const total = rows.into.length + rows.from.length;
  const table = (side: "into" | "from") => (
    <>
      <BraidsTable
        side={side}
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

  const guideAndNew = can.canCreate ? (
    <>
      <GuideLink />
      <NewBraidButton placement="inline" onOpen={() => openBraid("new")} />
    </>
  ) : (
    <GuideLink />
  );
  let intoContent: ReactNode = (
    <EmptyLine>{`${projectName} doesn't braid its spans anywhere yet.`}</EmptyLine>
  );
  if (rows.into.length > 0) intoContent = table("into");
  else if (planState === "enterprise") intoContent = <BraidsHowItWorks actions={guideAndNew} />;
  const asked = query[BRAID_QUERY_KEY];
  const editing = braids.data.intoOtherProjects.find((braid) => braid.braidId === asked);
  const drawerOpen = (asked === "new" && can.canCreate) || (!!editing && can.canEditInto);

  return (
    <>
      <BraidsHeader
        projectName={projectName}
        actions={
          <>
            <GuideLink />
            {can.canCreate ? (
              <NewBraidButton placement="header" onOpen={() => openBraid("new")} />
            ) : null}
          </>
        }
      />
      <Stack gap={4}>
        {paused ? (
          <Banner
            status="warning"
            title="Braids are paused"
            action={
              <BannerAction asChild>
                <Link href="/settings/plans">See plans</Link>
              </BannerAction>
            }
          >
            Braids need the Enterprise plan. Your {total === 1 ? "braid is" : `${total} braids are`}{" "}
            kept and start working again when you upgrade.
          </Banner>
        ) : null}
        {can.showKeptToAdminsNote ? (
          <Banner
            status="info"
            title="Your organisation's admins manage braids"
            action={
              <BannerAction asChild>
                <Link href="/settings/directory">Ask an admin</Link>
              </BannerAction>
            }
          >
            Your organisation keeps braids to its admins, so only they can create, change or remove
            them.
          </Banner>
        ) : null}
        <ContentTabs
          label="Braids"
          value={tab}
          onValueChange={({ value }) => setTab(value)}
          items={[
            {
              value: "into",
              label: "Into other projects",
              count: rows.into.length,
              testId: "braids-tab-into",
              content: intoContent,
            },
            {
              value: "from",
              label: "From other projects",
              count: rows.from.length,
              testId: "braids-tab-from",
              content:
                rows.from.length > 0 ? (
                  table("from")
                ) : (
                  <EmptyLine>{`No project braids its spans into ${projectName}.`}</EmptyLine>
                ),
            },
            {
              value: "keys",
              label: "Signing keys",
              testId: "braids-tab-keys",
              content: <BraidsSigningKeys projectId={projectId} planState={planState} />,
            },
          ]}
        />
      </Stack>
      {drawerOpen ? (
        <BraidDrawer
          key={asked}
          projectId={projectId}
          editing={editing}
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
