# Scope selector and badges

Settings surfaces that scope a row (model providers, virtual keys, budgets,
routing policies, default models, data retention) use one shared selector,
`ScopeChipPicker`, and one shared badge, `ProviderScopeChips`. Reuse them; do
not hand-roll a checkbox list of teams/people or a bespoke scope dropdown.

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
