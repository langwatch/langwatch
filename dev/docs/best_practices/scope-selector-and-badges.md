# Scope selector and badges

Settings surfaces that scope a row (model providers, virtual keys, budgets,
routing policies, default models, data retention, data privacy) use one shared
selector, `ScopeChipPicker`, and one shared badge, `ProviderScopeChips`.

**This is a hard rule for every NEW scoped-resource drawer too, not just the
consumers listed above:** any form where the user picks which scope(s) a rule
or resource applies to renders `ScopeChipPicker`. Never hand-roll a checkbox
list of teams/people, a bespoke scope `<Select>`, or a one-off "scope + toggle"
combination. Multi-scope selection is the default (one save can target several
teams, a team and two projects, etc., producing one row per scope); rows that
can live at exactly one scope pass `singleSelect`.

## The scope kinds

| Kind          | Means                                         | Backed by                          |
|---------------|-----------------------------------------------|------------------------------------|
| `ORGANIZATION`| Everyone in the org                           | `ModelProviderScopeType` enum      |
| `TEAM`        | Every project in a team                       | `ModelProviderScopeType` enum      |
| `PROJECT`     | One project                                   | `ModelProviderScopeType` enum      |
| `DEPARTMENT`  | Every member of a department (a people group) | picker/badge only, no enum row     |

`ORGANIZATION` / `TEAM` / `PROJECT` are the **resource triad** that maps 1:1 to
the Prisma `ModelProviderScopeType` enum and persists to scoped-resource tables
(see `scoped-resources.md`). `DEPARTMENT` is a different axis: it groups
**people** (`OrganizationUser.departmentId`), cross-cuts teams, and has no enum
row. It exists for "who can see this" surfaces such as the AI tool catalog tile
visibility, never for resource-tree scoping.

## Picking a scope: `ScopeChipPicker`

`ScopeChipPicker` is generic over its scope-type union and **defaults to the
triad**, so resource consumers stay narrow without any change:

```tsx
// Resource consumer (model provider): triad only, DEPARTMENT can never leak in.
const [scopes, setScopes] = useState<ScopeTriadEntry[]>([]);
<ScopeChipPicker value={scopes} onChange={setScopes} ... />
```

A consumer opts into the department cut by passing `allowedScopeTypes` and the
wider `ScopeChipPickerEntry`:

```tsx
// AI tool catalog tile: whole organization OR specific departments.
const [scopes, setScopes] = useState<ScopeChipPickerEntry[]>([]);
<ScopeChipPicker
  value={scopes}
  onChange={setScopes}
  allowedScopeTypes={["ORGANIZATION", "DEPARTMENT"]}
  availableDepartments={api.departments.list.useQuery({ organizationId }).data ?? []}
/>
```

- Use `ScopeTriadEntry` / `ScopeTriadType` for triad-only state; use
  `ScopeChipPickerEntry` / `ScopeChipPickerScopeType` only where DEPARTMENT is
  actually offered. This keeps the type system from letting a department id
  flow into a `ModelProviderScopeType` write.
- The picker collapses redundant picks (`collapseRedundantScopes`): picking
  `ORGANIZATION` clears narrower picks; departments are mutually-compatible
  siblings and an org-wide pick clears them.

## Personal-projects variants: `personalScopes`

Resources that can target personal workspaces (per-user CLI projects) opt in
with the `personalScopes` prop instead of adding a separate toggle next to the
picker. The dropdown gains a "Personal projects" group offering "All personal
projects" (`ORGANIZATION` + `personalOnly: true`) and, when departments are
available, each department's personal projects (`DEPARTMENT` +
`personalOnly: true`); specific personal projects are ordinary `PROJECT`
entries. Emitted entries carry `personalOnly: true`, and the personal variant
of a scope is a DISTINCT selection from the plain scope (both can hold their
own rule; redundancy collapse keys on the pair). Data privacy is the reference
consumer.

```tsx
// Data privacy rule: any scope kind, personal variants included.
const [scopes, setScopes] = useState<ScopeChipPickerEntry[]>([]);
<ScopeChipPicker
  value={scopes}
  onChange={setScopes}
  allowedScopeTypes={["ORGANIZATION", "DEPARTMENT", "TEAM", "PROJECT"]}
  personalScopes
  ...
/>
```

## Rendering a scope: `ProviderScopeChips`

```tsx
<ProviderScopeChips scopes={[{ scopeType: "DEPARTMENT", scopeId, name }]} />
```

Each kind has a fixed icon + colour so chips read the same everywhere:
`ORGANIZATION` Building2 / blue, `TEAM` Users / purple, `PROJECT` Folder,
`DEPARTMENT` Boxes / cyan ("Department: <name>"). Pass `name` so the chip shows
a label instead of the bare id.

## Adding a new cut

1. Add the literal to `ScopeChipPickerScopeType` (and `ProviderScopeType`) in
   `ScopeChipPicker.tsx` / `ProviderScopeChips.tsx`; keep `ScopeTriadType`
   untouched so resource consumers are unaffected.
2. Give it an icon + colour in `ProviderScopeChips` and a `ScopeIcon` entry,
   plus an option-builder branch gated on `allowed.has(<KIND>)`.
3. Extend `collapseRedundantScopes` with the new kind's redundancy rules.
4. Only the surfaces that opt in via `allowedScopeTypes` ever see it.

The URL filter form of scoping (`?scope=TYPE:id`, `ScopeFilter` +
`useUrlScopeFilter`) is a separate read-side concern; it stays on the resource
triad.
