/**
 * Save and Open, in the query card's header.
 *
 * Two controls with two different jobs. Open picks a chart to work on. The
 * chart menu manages the one that is open — and it only exists once a chart is
 * open, because rename and delete are questions about a specific chart rather
 * than about the workbench. Delete asks before it acts: nothing here is
 * recoverable, and it sits one item below Rename.
 *
 * Save says which it will do: with a chart open it reads "Save", writes back to
 * that chart, and creates nothing; with none open it reads "Save chart" and
 * asks for a name first. A member should never have to guess whether pressing
 * it will leave them with one chart or two.
 *
 * @see dev/docs/best_practices/row-actions-overflow-menu.md
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { Button, Input, Stack, Text } from "@chakra-ui/react";
import { ChevronDown, FolderOpen, MoreVertical, Save } from "lucide-react";
import { useRef, useState } from "react";

import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { Dialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/menu";

import type { SavedChartSummary } from "../hooks/useSavedWorkbenchCharts";

export interface SavedChartsToolbarProps {
  readonly charts: readonly SavedChartSummary[];
  readonly openedChartId: string | null;
  readonly openedChartName: string | null;
  readonly isSaving: boolean;
  /** Whether there is anything worth saving — an empty statement is not. */
  readonly canSave: boolean;
  readonly onSave: (input: { name?: string }) => void;
  readonly onOpen: (chartId: string) => void;
  readonly onRename: (input: { id: string; name: string }) => void;
  readonly onDelete: (chartId: string) => void;
  /** Detaches the open chart so the next Save creates a new one. */
  readonly onSaveAsNew: () => void;
}

/**
 * Asks for a name.
 *
 * One field and one action: the destructive-looking alternative — a Cancel
 * button beside Save — is left out deliberately, because the dialog's own
 * dismissal already means "not now" and two ways to back out is one too many.
 *
 * The field is seeded once, at mount, and never re-seeded — so the caller must
 * mount a fresh one per opening (see the `key` where it is rendered). Anything
 * that re-seeded on `open` would have to be told the dialog opened, and a
 * controlled `open` never says so.
 */
function NameDialog({
  title,
  initialName,
  open,
  onOpenChange,
  onSubmit,
}: {
  title: string;
  initialName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const field = useRef<HTMLInputElement>(null);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(event) => onOpenChange(event.open)}
      // The dialog parks focus on its own content by default, and takes it back
      // on the first re-render, so a typed name lost every character after the
      // first. Naming the field is what holds focus where the member is typing.
      initialFocusEl={() => field.current}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Stack gap={2}>
            <Text fontSize="13px" color="fg.muted">
              Name
            </Text>
            <Input
              ref={field}
              value={name}
              aria-label="Chart name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
            />
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            size="sm"
            colorPalette="orange"
            disabled={name.trim().length === 0}
            onClick={submit}
          >
            Save
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * The name of the chart that is open, and what can be done to it.
 *
 * Only rendered while one is open, because rename, save-as-new and delete are
 * all questions about a specific chart. Delete asks before it acts: a saved
 * chart is not recoverable, and Delete sits one item below Rename.
 */
function OpenedChartMenu({
  chartId,
  chartName,
  onRename,
  onSaveAsNew,
  onDelete,
}: {
  chartId: string;
  chartName: string | null;
  onRename: () => void;
  onSaveAsNew: () => void;
  onDelete: (chartId: string) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <>
      <Text
        fontSize="12px"
        color="fg.muted"
        maxWidth="180px"
        truncate
        title={chartName ?? undefined}
        data-testid="opened-chart-name"
      >
        {chartName}
      </Text>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            size="xs"
            variant="ghost"
            aria-label={`Actions for ${chartName ?? "this chart"}`}
            data-testid="opened-chart-actions"
          >
            <MoreVertical size={14} aria-hidden="true" />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item value="rename" onClick={onRename}>
            Rename
          </Menu.Item>
          <Menu.Item value="save-as-new" onClick={onSaveAsNew}>
            Save as a new chart
          </Menu.Item>
          <Menu.Item
            value="delete"
            color="red.solid"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete chart"
        message={`Delete "${chartName ?? "this chart"}"? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          setConfirmingDelete(false);
          onDelete(chartId);
        }}
      />
    </>
  );
}

export function SavedChartsToolbar({
  charts,
  openedChartId,
  openedChartName,
  isSaving,
  canSave,
  onSave,
  onOpen,
  onRename,
  onDelete,
  onSaveAsNew,
}: SavedChartsToolbarProps) {
  const [naming, setNaming] = useState<"save" | "rename" | null>(null);

  const handleSave = () => {
    // An open chart already has a name; asking again would turn every save
    // into a dialog the member has to dismiss.
    if (openedChartId) return onSave({});
    setNaming("save");
  };

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            size="xs"
            variant="ghost"
            aria-label="Open a saved chart"
            data-testid="open-saved-chart"
          >
            <FolderOpen size={14} aria-hidden="true" />
            <Text fontSize="12px">Open</Text>
            <ChevronDown size={12} aria-hidden="true" />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          {charts.length === 0 ? (
            <Menu.Item value="none" disabled>
              No saved charts yet
            </Menu.Item>
          ) : (
            charts.map((chart) => (
              <Menu.Item
                key={chart.id}
                value={chart.id}
                onClick={() => onOpen(chart.id)}
              >
                {chart.name}
              </Menu.Item>
            ))
          )}
        </Menu.Content>
      </Menu.Root>

      <Button
        size="xs"
        variant="ghost"
        disabled={!canSave || isSaving}
        onClick={handleSave}
        data-testid="save-chart"
      >
        <Save size={14} aria-hidden="true" />
        <Text fontSize="12px">{openedChartId ? "Save" : "Save chart"}</Text>
      </Button>

      {openedChartId && (
        <OpenedChartMenu
          chartId={openedChartId}
          chartName={openedChartName}
          onRename={() => setNaming("rename")}
          onSaveAsNew={onSaveAsNew}
          onDelete={onDelete}
        />
      )}

      {/*
       * Keyed on what the dialog is for, so each opening gets its own instance
       * and its own freshly seeded field. Without it one instance is reused:
       * Rename opens empty, and whatever was typed into the last Save is still
       * sitting there the next time it opens.
       */}
      <NameDialog
        key={naming ?? "closed"}
        title={naming === "rename" ? "Rename chart" : "Save chart"}
        initialName={naming === "rename" ? (openedChartName ?? "") : ""}
        open={naming !== null}
        onOpenChange={(open) => {
          if (!open) setNaming(null);
        }}
        onSubmit={(name) => {
          // A rename with no chart open must refuse, not fall through: saving
          // instead would answer "rename this chart" by creating a second one.
          if (naming === "rename") {
            if (openedChartId) onRename({ id: openedChartId, name });
            return;
          }
          onSave({ name });
        }}
      />
    </>
  );
}
