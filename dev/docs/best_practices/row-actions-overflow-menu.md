# Row actions: the overflow menu

Per-row actions (edit, rename, enable/disable, delete, archive) on a list or
table ALWAYS live in a single vertical three-dot overflow menu in the row's
trailing cell. Not inline text buttons, not a row of icon buttons, and never a
"Cancel" button inside the row's edit drawer (the drawer's `X` close already
cancels).

This is the only pattern. One trigger per row keeps rows scannable, keeps
destructive actions one deliberate click away, and stays consistent with every
other settings table (model providers, default models, departments, LLM model
costs, secrets, API keys).

## The pattern

Import `Menu` from the local UI wrapper (see
`dev/docs/design/components.md`), not from Chakra directly, and use the
`MoreVertical` lucide icon as the trigger.

```tsx
import { Menu } from "~/components/ui/menu";
import { MoreVertical } from "lucide-react";

<Menu.Root>
  <Menu.Trigger asChild>
    <Button size="xs" variant="ghost" aria-label={`Actions for ${row.name}`}>
      <MoreVertical size={14} />
    </Button>
  </Menu.Trigger>
  <Menu.Content>
    <Menu.Item value="edit" onClick={(e) => { e.stopPropagation(); onEdit(row); }}>
      Edit
    </Menu.Item>
    <Menu.Item value="toggle" onClick={(e) => { e.stopPropagation(); onToggle(row); }}>
      {row.enabled ? "Disable" : "Enable"}
    </Menu.Item>
    <Menu.Item
      value="delete"
      color="red.500"
      onClick={(e) => { e.stopPropagation(); onDelete(row); }}
    >
      Delete
    </Menu.Item>
  </Menu.Content>
</Menu.Root>
```

Rules:

- `Menu.Trigger asChild` wraps a `Button` (ghost) holding the `MoreVertical`
  icon. Give the button an `aria-label` naming the row.
- Destructive items (`Delete` / `Archive`) are tinted red (`color="red.500"`).
  Prefer archive over hard delete for anything with history; see
  `soft-delete-vs-archive.md`.
- Call `event.stopPropagation()` in every `onClick` when the row itself is
  clickable or drag-sortable, so opening the menu or picking an action does not
  also fire the row's handler.
- `Menu.Content` is portalled by default, so it overlays rather than reflowing
  the table; you do not need to manage z-index or width.
- Gate actions the caller cannot perform by conditionally rendering the
  `Menu.Item` (or the whole `Menu.Root` when no action is available), and wrap
  the trigger in a `Tooltip` when explaining a disabled state.

## Drawers opened from a row

The edit drawer reached from an overflow-menu `Edit` follows `drawers.md`. It
has a single primary action (Save) and the drawer chrome's `X` to dismiss.
Do not add a separate `Cancel` button: it duplicates the `X` and crowds the
footer.

## Canonical examples

- `src/pages/settings/governance/departments.tsx` (departments row)
- `src/pages/settings/model-providers.tsx` (provider row, with a permission
  tooltip on the trigger)
- `src/components/settings/governance/ToolCatalogEditor.tsx` (AI tool catalog
  tile row: Edit / Enable-Disable / Delete-archive)
