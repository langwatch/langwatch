/**
 * The sidebar's "Dashboards" section, lent through `StarredDashboardsToken` (§10.1): the
 * member's pins in the project, the first 7 then "All pinned (N)", and a "+" that opens a new
 * dashboard with "Add a widget" open, pinned once its first edit stores it.
 * @see modules/navigation/specs/product-sidebars.feature
 */

import type { StarredDashboardsProps } from "@langwatch/analytics-client";
import { SidebarSectionLabel } from "@langwatch/design-system/app-shell";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Box, HStack, VStack } from "@langwatch/design-system/primitives";
import { LayoutDashboard } from "lucide-react";
import { type ReactNode, useState } from "react";

import { InProject } from "../../../../behavior/in-project.tsx";
import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useBoardAccess, useBoardReader } from "../../behavior/use-board-access.ts";
import { useBoardFromTemplate } from "../../behavior/use-board-from-template.ts";
import { useStartDraft } from "../../behavior/use-draft-board.ts";
import { useFavourites } from "../../behavior/use-favourites.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { dashboardsPath, myDashboardId } from "../../model/boards.ts";
import { CURATED_BOARDS } from "../../model/curated-boards.ts";
import {
  isOpenStar,
  type SidebarBoard,
  type StarredLink,
  starredLinks,
} from "../../model/sidebar-boards.ts";
import { AddDashboardRow } from "../blocks/add-dashboard-row.tsx";
import { SavedDashboardRow } from "../blocks/saved-dashboard-row.tsx";
import { SIDEBAR_ROW_ICON_SIZE, SidebarLinkRow } from "../blocks/sidebar-link-row.tsx";
import { NewDashboardButton } from "../elements/new-dashboard-button.tsx";

/** Rows shown before the rest sit behind "All pinned (N)": the sidebar stays short. */
const PINNED_SHOWN_MAX = 7;

/** What the create path offers: the "+" and the empty-state item both run `onAdd`. */
type CreateControls = { onAdd: () => void };

export function StarredDashboardsSection({ project }: StarredDashboardsProps) {
  if (!project) return <PinnedDashboards />;
  return (
    <InProject project={project}>
      <PinnedDashboards />
    </InProject>
  );
}

/** The section over the project in scope. */
function PinnedDashboards() {
  const host = useAnalyticsHost();
  const favourites = useFavourites();
  const { mayCreate } = useBoardReader();
  const projectSlug = host.project()?.slug;
  if (!projectSlug) return null;
  const isLoaded = !favourites.isLoading && !favourites.loadError;
  const links = isLoaded
    ? starredLinks({ stars: favourites.stars, curated: CURATED_BOARDS, projectSlug })
    : [];
  // A member who may not add one sees the section only for what it lists.
  if (!mayCreate && links.length === 0) return null;
  const frame = (create?: CreateControls) => (
    <SectionFrame links={links} isLoaded={isLoaded} projectSlug={projectSlug} create={create} />
  );
  // Only members who may create mount the create path.
  return mayCreate ? <WithCreate>{frame}</WithCreate> : frame();
}

function WithCreate({ children }: { children: (create: CreateControls) => ReactNode }) {
  const host = useAnalyticsHost();
  const startDraft = useStartDraft();
  const project = host.project();
  return children({
    // Pinned once stored; drop `pin` to stop pinning.
    onAdd: () =>
      startDraft({
        projectId: project?.id ?? "",
        projectSlug: project?.slug ?? "",
        pin: true,
        addWidget: true,
      }),
  });
}

function SectionFrame({
  links,
  isLoaded,
  projectSlug,
  create,
}: {
  links: StarredLink[];
  isLoaded: boolean;
  projectSlug: string;
  create?: CreateControls;
}) {
  const shown = links.slice(0, PINNED_SHOWN_MAX);
  // One title in every product (G13); the project shows in the top bar, not here.
  const label = "Dashboards";

  return (
    <VStack as="section" aria-label={label} align="stretch" gap={0.5} width="full">
      {/* The same frame and label as navigation's own groups, so it reads like "Build". */}
      <HStack minHeight="28px" paddingX={2} paddingTop={2.5} paddingBottom={0.5} gap={1}>
        <Box minWidth={0} overflow="hidden">
          <SidebarSectionLabel label={label} />
        </Box>
        {create && <NewDashboardButton onCreate={create.onAdd} />}
      </HStack>
      <VStack as="ul" align="stretch" gap={0.5} margin={0} padding={0}>
        {create && isLoaded && links.length === 0 && <AddDashboardRow onAdd={create.onAdd} />}
        {shown.map((link) =>
          link.board ? (
            <PinnedBoardRow key={link.key} link={link} board={link.board} />
          ) : (
            <PinnedStarRow key={link.key} link={link} />
          ),
        )}
        {links.length > PINNED_SHOWN_MAX && (
          <SidebarLinkRow
            name={`All pinned (${links.length})`}
            href={dashboardsPath({ projectSlug })}
          />
        )}
      </VStack>
    </VStack>
  );
}

/** A pinned board; one the member may edit, delete or copy also loads the board list. */
function PinnedBoardRow({ link, board }: { link: StarredLink; board: SidebarBoard }) {
  const { access } = useBoardAccess(board);
  const isManaged = access.canEdit || access.canDelete || access.canDuplicate;
  return isManaged ? (
    <ManagedBoardRow link={link} board={board} access={access} />
  ) : (
    <PinnedStarRow link={link} />
  );
}

/** The "⋮" menu with only Unpin: a From LangWatch board, or one the member only reads. */
function PinnedStarRow({ link }: { link: StarredLink }) {
  const favourites = useFavourites();
  const { params } = useAnalyticsHost().route();
  return (
    <SavedDashboardRow
      name={link.name}
      href={link.href}
      isActive={isOpenStar({ star: link.star, params })}
      icon={<PinnedIcon />}
      actions={{
        isStarred: favourites.isStarred(link.star),
        onToggleStar: () => favourites.toggleStar(link.star),
        isRenaming: false,
        onRenameCommit: () => {},
        onRenameCancel: () => {},
      }}
    />
  );
}

function PinnedIcon() {
  return <LayoutDashboard size={SIDEBAR_ROW_ICON_SIZE} strokeWidth={1.9} aria-hidden />;
}

/** The saved-dashboards row menu on a pinned board: what this member may do with it. */
function ManagedBoardRow({
  link,
  board,
  access,
}: {
  link: StarredLink;
  board: SidebarBoard;
  access: ReturnType<typeof useBoardAccess>["access"];
}) {
  const host = useAnalyticsHost();
  const saved = useSavedDashboards();
  const favourites = useFavourites();
  const fromTemplate = useBoardFromTemplate();
  const [isRenaming, setIsRenaming] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  // My dashboard cannot be deleted, and keeps its name only until it is marked theirs.
  const isMine = myDashboardId({ boards: [board], userId: host.userId() }) === board.id;
  const keepsName = isMine && !board.myDashboardOfUserId;
  return (
    <>
      <SavedDashboardRow
        name={link.name}
        href={link.href}
        isActive={isOpenStar({ star: link.star, params: host.route().params })}
        icon={<PinnedIcon />}
        actions={{
          isStarred: favourites.isStarred(link.star),
          onToggleStar: () => favourites.toggleStar(link.star),
          isRenaming,
          ...(access.canEdit
            ? { rename: keepsName ? {} : { onStart: () => setIsRenaming(true) } }
            : {}),
          ...(access.canDuplicate
            ? {
                duplicate: {
                  label: access.canEdit ? "Duplicate" : "Duplicate to edit",
                  onDuplicate: () =>
                    void fromTemplate.duplicateBoard({
                      board,
                      existingNames: saved.boards.map(({ name }) => name),
                    }),
                },
              }
            : {}),
          ...(access.canDelete
            ? { remove: isMine ? {} : { onDelete: () => setIsConfirmingDelete(true) } }
            : {}),
          onRenameCommit: (name) => {
            setIsRenaming(false);
            saved.renameBoard({ dashboardId: board.id, name });
          },
          onRenameCancel: () => setIsRenaming(false),
        }}
      />
      <ConfirmDialog
        open={isConfirmingDelete}
        onOpenChange={setIsConfirmingDelete}
        title="Delete dashboard"
        message={`Delete "${board.name}" and every widget on it? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        loading={saved.isDeleting}
        onConfirm={() =>
          saved.deleteBoard({
            dashboardId: board.id,
            onDeleted: () => setIsConfirmingDelete(false),
          })
        }
      />
    </>
  );
}
