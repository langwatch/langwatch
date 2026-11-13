/**
 * The "Dashboards" section in the LLM Ops sidebar, lent through `StarredDashboardsToken`
 * (§10.1): the dashboards the member pinned to the project (their stars there), the first 7
 * then "All pinned (N)", and a "+" that makes a pinned dashboard and opens "Add a widget".
 * @see modules/navigation/specs/product-sidebars.feature
 */

import type { StarredDashboardsProps } from "@langwatch/analytics-client";
import { SidebarSectionLabel } from "@langwatch/design-system/app-shell";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Box, Link as ChakraLink, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { LayoutDashboard, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-link.tsx";
import { useBoardAccess, useBoardReader } from "../../behavior/use-board-access.ts";
import { useBoardFromTemplate } from "../../behavior/use-board-from-template.ts";
import { useFavourites } from "../../behavior/use-favourites.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { dashboardsPath, myDashboardId } from "../../model/boards.ts";
import { CURATED_BOARDS } from "../../model/curated-boards.ts";
import { type SidebarBoard, type StarredLink, starredLinks } from "../../model/sidebar-boards.ts";
import { SavedDashboardRow } from "../blocks/saved-dashboard-row.tsx";
import { NewDashboardButton } from "../elements/new-dashboard-button.tsx";

/** Rows shown before the rest sit behind "All pinned (N)": the sidebar stays short. */
const PINNED_SHOWN_MAX = 7;

/** What the create path offers: the "+" and the empty-state item both run `onAdd`. */
type CreateControls = { isCreating: boolean; onAdd: () => void };

export function StarredDashboardsSection(_props: StarredDashboardsProps) {
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
  // The create path reads the board list to name the new one; only members who may create mount it.
  return mayCreate ? <WithCreate>{frame}</WithCreate> : frame();
}

function WithCreate({ children }: { children: (create: CreateControls) => ReactNode }) {
  const saved = useSavedDashboards();
  return children({
    isCreating: saved.isCreating,
    // Pinned on creation; drop `pin` to stop pinning.
    onAdd: () => saved.createBoard({ pin: true, addWidget: true }),
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

  return (
    <VStack as="section" aria-label="Dashboards" align="stretch" gap={0.5} width="full">
      {/* The same frame and label as navigation's own groups, so it reads like "Build". */}
      <HStack minHeight="28px" paddingX={2} paddingTop={2.5} paddingBottom={0.5} gap={1}>
        <SidebarSectionLabel label="Dashboards" />
        {create && <NewDashboardButton isCreating={create.isCreating} onCreate={create.onAdd} />}
      </HStack>
      <VStack as="ul" align="stretch" gap={0.5} margin={0} padding={0}>
        {create && isLoaded && links.length === 0 && (
          <AddDashboardRow isCreating={create.isCreating} onAdd={create.onAdd} />
        )}
        {shown.map((link) =>
          link.board ? (
            <PinnedBoardRow key={link.key} link={link} board={link.board} />
          ) : (
            <PinnedStarRow key={link.key} link={link} />
          ),
        )}
        {links.length > PINNED_SHOWN_MAX && (
          <AllPinnedRow
            name={`All pinned (${links.length})`}
            href={dashboardsPath({ projectSlug })}
          />
        )}
      </VStack>
    </VStack>
  );
}

/** The dotted-outline first item while nothing is pinned; it does what the "+" does. */
function AddDashboardRow({ isCreating, onAdd }: { isCreating: boolean; onAdd: () => void }) {
  return (
    <Box as="li" listStyleType="none" width="full">
      <Box
        as="button"
        display="flex"
        alignItems="center"
        gap={2}
        width="full"
        borderRadius="lg"
        borderWidth="1px"
        borderStyle="dashed"
        borderColor="border.emphasized"
        paddingX={2}
        paddingY="3px"
        textStyle="bodySm"
        color="fg.subtle"
        cursor="pointer"
        _hover={{ color: "fg", background: "border/50" }}
        aria-disabled={isCreating || void 0}
        onClick={() => {
          if (!isCreating) onAdd();
        }}
      >
        <Plus size={14} aria-hidden />
        Add dashboard
      </Box>
    </Box>
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
  return (
    <SavedDashboardRow
      name={link.name}
      href={link.href}
      isActive={false}
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
  return <LayoutDashboard size={14} strokeWidth={1.9} aria-hidden />;
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
  // My dashboard keeps its name and cannot be deleted.
  const isMine = myDashboardId({ boards: [board], userId: host.userId() }) === board.id;
  return (
    <>
      <SavedDashboardRow
        name={link.name}
        href={link.href}
        isActive={false}
        icon={<PinnedIcon />}
        actions={{
          isStarred: favourites.isStarred(link.star),
          onToggleStar: () => favourites.toggleStar(link.star),
          isRenaming,
          ...(access.canEdit
            ? { rename: isMine ? {} : { onStart: () => setIsRenaming(true) } }
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

/** The "All pinned (N)" row: a plain link into Dashboards, with no board behind it. */
function AllPinnedRow({ name, href }: { name: string; href: string }) {
  const host = useAnalyticsHost();
  return (
    <Box as="li" listStyleType="none" width="full">
      <ChakraLink
        href={href}
        display="flex"
        alignItems="center"
        gap={2}
        width="full"
        borderRadius="lg"
        paddingX={2}
        paddingY="4px"
        textStyle="bodySm"
        color="fg.subtle"
        textDecoration="none"
        _hover={{ color: "fg", background: "border/50" }}
        onClick={(event) => {
          if (opensElsewhere(event)) return;
          event.preventDefault();
          host.navigate(href);
        }}
      >
        <Text as="span" truncate minWidth={0}>
          {name}
        </Text>
      </ChakraLink>
    </Box>
  );
}
