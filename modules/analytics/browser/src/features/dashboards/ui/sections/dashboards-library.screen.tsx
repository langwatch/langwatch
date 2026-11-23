/**
 * `/dashboards`, the organization's Dashboards library (ADR-002): every board the member can
 * see, by home product; the one place a board moves between
 * products. Every board opens at `/dashboards/<id>`. dashboards-organization-area.feature
 */

import { UiPageLoading, UiPageNotFound } from "@langwatch/browser/page-fallbacks";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, Button, Heading, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { LayoutDashboard, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useBoardReader } from "../../behavior/use-board-access.ts";
import { useLibraryShowMore } from "../../behavior/use-library-show-more.ts";
import { useOrganizationLibrary } from "../../behavior/use-organization-library.ts";
import {
  groupHeading,
  LIBRARY_HEADER,
  type LibraryBoard,
  type LibraryGroup,
  libraryGroups,
  namesInProduct,
} from "../../model/organization-library.ts";
import { LibraryBoardRow } from "./library-board-rows.tsx";
import { MoveBoardDialog } from "./move-board-dialog.tsx";
import { NewDashboardDialog } from "./new-dashboard-dialog.tsx";

/** How many boards a group lists before "Show N more". */
const GROUP_MAX = 8;

const deleteMessage = (name: string) =>
  `Delete "${name}" and every widget on it? This cannot be undone.`;

export default function DashboardsLibraryScreen() {
  const library = useOrganizationLibrary();
  const [isNewDialogOpen, setIsNewDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LibraryBoard | undefined>();
  const [pendingMove, setPendingMove] = useState<LibraryBoard | undefined>();
  const { storeProject } = library;
  // The store project is one where the member may create, so having one is the permission.
  const mayCreate = storeProject !== void 0;

  if (readHandledError(library.loadError)?.code === "dashboards_not_enabled") {
    return <UiPageNotFound />;
  }
  if (library.isLoading) return <UiPageLoading />;

  // A copy goes to the store project too, so with none nothing is copied.
  const duplicates = mayCreate ? { onDuplicate: library.duplicateBoard } : {};
  const groups = libraryGroups({ boards: library.boards });
  const newButton = mayCreate ? (
    <Button size="sm" colorPalette="teal" onClick={() => setIsNewDialogOpen(true)}>
      <Plus size={14} aria-hidden />
      New dashboard
    </Button>
  ) : null;
  const loadError = library.loadError ? (
    <LoadError error={library.loadError} onRetry={library.retry} />
  ) : null;

  return (
    <Box width="full" maxWidth="960px" marginX="auto" paddingX={6} paddingY={8}>
      <LibraryHeader action={newButton} />
      <LibraryBody
        groups={groups}
        loadError={loadError}
        hasList={library.hasList}
        newButton={newButton}
        handlers={{ ...duplicates, onMove: setPendingMove, onDelete: setPendingDelete }}
      />
      <LibraryDialogs
        library={library}
        isNewDialogOpen={isNewDialogOpen}
        onCloseNewDialog={() => setIsNewDialogOpen(false)}
        pendingMove={pendingMove}
        onSettleMove={() => setPendingMove(void 0)}
        pendingDelete={pendingDelete}
        onSettleDelete={() => setPendingDelete(void 0)}
      />
    </Box>
  );
}

/** The groups, or why there are none: a failed read with a list held keeps the rows. */
function LibraryBody({
  groups,
  loadError,
  hasList,
  newButton,
  handlers,
}: {
  groups: LibraryGroup[];
  loadError: ReactNode;
  hasList: boolean;
  newButton: ReactNode;
  handlers: BoardHandlers;
}) {
  if (loadError && !hasList) return <>{loadError}</>;
  if (groups.length === 0) {
    return (
      <NoDataInfoBlock
        icon={<LayoutDashboard size={20} />}
        title="No dashboards yet"
        description="Make one for any product. It shows in that product's sidebar."
        primaryAction={newButton}
      />
    );
  }
  return (
    <VStack align="stretch" gap={6}>
      {loadError}
      {groups.map((group) => (
        <ProductGroup key={group.product} group={group} {...handlers} />
      ))}
    </VStack>
  );
}

function LibraryHeader({ action }: { action: ReactNode }) {
  return (
    <HStack justify="space-between" align="start" marginBottom={6}>
      <VStack align="start" gap={1}>
        <Heading as="h1" textStyle="pageTitle">
          {LIBRARY_HEADER.title}
        </Heading>
        <Text textStyle="bodySm" color="fg.muted">
          {LIBRARY_HEADER.hint}
        </Text>
      </VStack>
      {action}
    </HStack>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <VStack align="start" gap={2}>
      <HandledErrorAlert error={error} fallbackTitle="Couldn't load your dashboards." />
      <Button size="xs" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </VStack>
  );
}

/** The create and move dialogs and the delete confirmation; the screen owns which is open. */
function LibraryDialogs({
  library,
  isNewDialogOpen,
  onCloseNewDialog,
  pendingMove,
  onSettleMove,
  pendingDelete,
  onSettleDelete,
}: {
  library: ReturnType<typeof useOrganizationLibrary>;
  isNewDialogOpen: boolean;
  onCloseNewDialog: () => void;
  pendingMove: LibraryBoard | undefined;
  onSettleMove: () => void;
  pendingDelete: LibraryBoard | undefined;
  onSettleDelete: () => void;
}) {
  const { organizationName } = useBoardReader();
  const host = useAnalyticsHost();
  const { storeProject } = library;
  return (
    <>
      {isNewDialogOpen && storeProject && (
        <NewDashboardDialog
          takenNamesIn={(product) => namesInProduct({ boards: library.boards, product })}
          projectName={storeProject.name}
          organizationName={organizationName}
          mayShare={library.mayShare}
          isCreating={library.isCreating}
          onCreate={library.createBoard}
          onClose={onCloseNewDialog}
        />
      )}
      {pendingMove && (
        <MoveBoardDialog
          key={pendingMove.id}
          board={pendingMove}
          userId={host.userId()}
          isMoving={library.isMoving}
          onMove={(homeProduct) => library.moveBoard({ board: pendingMove, homeProduct })}
          onClose={onSettleMove}
        />
      )}
      <ConfirmDialog
        open={pendingDelete !== void 0}
        onOpenChange={(isOpen) => {
          if (!isOpen) onSettleDelete();
        }}
        title="Delete dashboard"
        message={deleteMessage(pendingDelete?.name ?? "")}
        confirmLabel="Delete"
        tone="danger"
        loading={library.isDeleting}
        onConfirm={() => {
          if (!pendingDelete) return;
          library.deleteBoard({ board: pendingDelete, onDeleted: onSettleDelete });
        }}
      />
    </>
  );
}

/** The duplicates are unset where there is no store project to copy into. */
type BoardHandlers = {
  onDuplicate?: (board: LibraryBoard) => void;
  onMove: (board: LibraryBoard) => void;
  onDelete: (board: LibraryBoard) => void;
};

function ProductGroup({
  group,
  onDuplicate,
  onMove,
  onDelete,
}: BoardHandlers & { group: LibraryGroup }) {
  const { showsAll, toggle } = useLibraryShowMore(group.product);
  const shown = showsAll ? group.boards : group.boards.slice(0, GROUP_MAX);
  const hidden = group.boards.length - shown.length;
  return (
    <VStack as="section" aria-label={group.label} align="stretch" gap={2}>
      <Text as="h2" textStyle="eyebrow" color="fg.subtle" paddingX={1}>
        {groupHeading(group)}
      </Text>
      <VStack
        as="ul"
        align="stretch"
        gap={0}
        margin={0}
        padding={0}
        borderWidth="1px"
        borderRadius="xl"
        background="bg"
        css={{ "& > li + li": { borderTopWidth: "1px", borderColor: "border" } }}
      >
        {shown.map((board) => (
          <LibraryBoardRow
            key={board.id}
            board={board}
            {...(onDuplicate ? { onDuplicate: () => onDuplicate(board) } : {})}
            onMove={() => onMove(board)}
            onDelete={() => onDelete(board)}
          />
        ))}
        {group.boards.length > GROUP_MAX && (
          <Box as="li" listStyleType="none">
            <Button
              variant="plain"
              size="sm"
              width="full"
              justifyContent="flex-start"
              color="fg.muted"
              onClick={toggle}
            >
              {hidden > 0 ? `Show ${hidden} more` : "Show less"}
            </Button>
          </Box>
        )}
      </VStack>
    </VStack>
  );
}
