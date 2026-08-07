/**
 * Save and Open, in the query card's header.
 *
 * Two controls with two different jobs. Open picks a chart to work on. The
 * chart menu manages the one that is open — and it only exists once a chart is
 * open, because rename and delete are questions about a specific chart rather
 * than about the workbench.
 *
 * Save says which it will do: with a chart open it reads "Save", writes back to
 * that chart, and creates nothing; with none open it reads "Save chart" and
 * asks for a name first. A member should never have to guess whether pressing
 * it will leave them with one chart or two.
 *
 * @see dev/docs/best_practices/row-actions-overflow-menu.md
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

import { Button, Input, Stack, Text } from "@chakra-ui/react";
import { ChevronDown, FolderOpen, MoreVertical, Save } from "lucide-react";
import { useState } from "react";

import { Dialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/menu";

import type { SavedChartSummary } from "../hooks/useSavedWorkbenchCharts";

export interface SavedChartsToolbarProps {
  readonly charts: readonly SavedChartSummary[];
  readonly openedChartId: string | null;
  readonly openedChartName: string | null;
  readonly isSaving: boolean;
  /** Whether there is anything worth saving — an empty statement is not. */
  readonly savable: boolean;
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

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(event) => {
        if (event.open) setName(initialName);
        onOpenChange(event.open);
      }}
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
              autoFocus
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

export function SavedChartsToolbar({
  charts,
  openedChartId,
  openedChartName,
  isSaving,
  savable,
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
        disabled={!savable || isSaving}
        onClick={handleSave}
        data-testid="save-chart"
      >
        <Save size={14} aria-hidden="true" />
        <Text fontSize="12px">{openedChartId ? "Save" : "Save chart"}</Text>
      </Button>

      {openedChartId && (
        <>
          <Text
            fontSize="12px"
            color="fg.muted"
            maxWidth="180px"
            truncate
            title={openedChartName ?? undefined}
            data-testid="opened-chart-name"
          >
            {openedChartName}
          </Text>
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                size="xs"
                variant="ghost"
                aria-label={`Actions for ${openedChartName ?? "this chart"}`}
                data-testid="opened-chart-actions"
              >
                <MoreVertical size={14} aria-hidden="true" />
              </Button>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item value="rename" onClick={() => setNaming("rename")}>
                Rename
              </Menu.Item>
              <Menu.Item value="save-as-new" onClick={onSaveAsNew}>
                Save as a new chart
              </Menu.Item>
              <Menu.Item
                value="delete"
                color="red.500"
                onClick={() => onDelete(openedChartId)}
              >
                Delete
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        </>
      )}

      <NameDialog
        title={naming === "rename" ? "Rename chart" : "Save chart"}
        initialName={naming === "rename" ? (openedChartName ?? "") : ""}
        open={naming !== null}
        onOpenChange={(open) => {
          if (!open) setNaming(null);
        }}
        onSubmit={(name) => {
          if (naming === "rename" && openedChartId) {
            onRename({ id: openedChartId, name });
            return;
          }
          onSave({ name });
        }}
      />
    </>
  );
}
