# Bulk selection: the floating action bar

When a table or list lets the user select multiple rows, the actions for that
selection (delete, export, add to dataset, ...) live in a single bar that floats
at the **bottom-center of the viewport** while there is a selection. Not an
inline toolbar button, not a row of buttons that shifts the header, not a gray
chip at the top.

One floating bar keeps the selection actions in the same place on every surface
(traces, datasets, ...), keeps them out of the way until there is something to
act on, and reads as "here is what you can do with what you picked".

## The pattern

Use the shared `SelectionActionBar` shell from `~/components/ui/SelectionActionBar`.
It owns the position, the **white** surface (`bg.panel`, never `bg.emphasized`),
the border, the shadow, and the trailing clear-selection `X`. You pass the count
label and the action buttons.

```tsx
import { SelectionActionBar } from "~/components/ui/SelectionActionBar";

{selectedRows.size > 0 && (
  <SelectionActionBar
    label={`${selectedRows.size} selected`}
    onClear={clearSelection}
  >
    <Button size="xs" variant="outline" colorPalette="red" onClick={deleteSelected}>
      <Trash2 size={14} /> Delete
    </Button>
  </SelectionActionBar>
)}
```

Rules:

- The surface is white (`bg.panel`). A gray bar reads as disabled or as chrome.
- The bar is `position="fixed"` at `bottom={6}`, centered with
  `left="50%" + translateX(-50%)`. The `X` clear button is rendered by the shell,
  so do not add your own.
- The label is the count ("N selected"); the action buttons carry the verbs
  (Delete, Export selected, Add to dataset). Do not repeat the count on the
  button.
- `zIndex` is 20: above the page, below modals and drawers. Inside a modal or
  drawer a viewport-fixed bar would sit behind the overlay, so for an editor that
  is also embedded in a dialog, gate the floating bar behind a prop and keep an
  inline action for the embedded case (see `DatasetEditorTable`'s
  `floatingSelectionBar`).

## Canonical examples

- `src/features/traces-v2/components/Toolbar/BulkActionBar.tsx` (traces: export +
  add-to-dataset, with select-all-matching)
- `src/components/datasets/editor/DatasetEditorTable.tsx` (dataset detail page:
  delete selected rows, behind `floatingSelectionBar`)
