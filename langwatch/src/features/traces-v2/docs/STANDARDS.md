# Traces v2 — Engineering Standards

Status: DRAFT
Date: 2026-04-23

Standards for building the traces-v2 feature. Covers React patterns, state management,
design tokens, spec format, and testing. Every component, hook, and spec in traces-v2
follows these conventions.

---

## Architecture

```
┌───────────────────────────────────────────────────────┐
│                    COMPONENTS                         │
│  (TraceTable, Drawer, FilterSidebar, SearchBar, etc.) │
│  Zero data logic. Read from hooks only.               │
├───────────────────────────────────────────────────────┤
│                   DATA HOOKS LAYER                    │
│  useTraceList, useTraceHeader, useSpanDetail, etc.    │
│  Each hook: reads Zustand (intent) + calls TQ (data)  │
├───────────┬───────────────────────────────────────────┤
│  ZUSTAND  │         TANSTACK QUERY                    │
│  (intent) │         (server state + cache)             │
│           │                                           │
│  filter   │  queryClient (httpBatchStreamLink)         │
│  view     │  ├─ trace.list (stale: 30s)               │
│  drawer   │  ├─ trace.header (stale: 5min)            │
│  ui       │  ├─ span.summary (stale: 5min)            │
│           │  ├─ span.detail (stale: 5min)             │
│           │  ├─ trace.evals (stale: 60s)              │
│           │  └─ trace.facets (stale: 30s)             │
├───────────┴─────────┬─────────────────────────────────┤
│  tRPC CLIENT        │  SSE (sseLink, existing)        │
│  (typed, batched,   │  Live tail subscription         │
│   streamed JSON-L)  │  Pushes into TQ cache           │
├─────────────────────┴─────────────────────────────────┤
│         NEW tRPC ROUTER (traces-v2)                   │
│         ClickHouse direct queries                     │
│         src/server/api/routers/traces-v2/             │
├───────────────────────────────────────────────────────┤
│                   CLICKHOUSE                          │
│  trace_summaries | stored_spans | evaluation_runs     │
└───────────────────────────────────────────────────────┘
```

**Key rules:**
- Components never import tRPC or Zustand directly. They call data hooks.
- Data hooks are the ONLY bridge between intent (Zustand) and data (TanStack Query).
- Zustand stores hold what the user wants (filters, active view, which drawer is open).
- TanStack Query holds what the server has (trace data, facets, evals).
- The filter AST in Zustand is the single source of truth for two-way search/facet sync.

### Progressive Loading (5 levels)

```
Level 1: Table        → fetch only visible columns (trace.list)
Level 2: Drawer open  → fetch trace header (trace.header)
Level 3: Span tree    → fetch span skeleton with timing (span.summary)
Level 4: Span click   → fetch full span detail (span.detail)
Level 5: Accordion     → fetch events/evals on expand (trace.evals)
```

Each level fires via TanStack Query's `enabled` flag. No query runs until needed.

---

## 1. File Organization

Nested per-component directories. Complex components get subdirectories for
sub-components. Tests live in `__tests__/` within each directory.

```
features/traces-v2/
├── components/
│   ├── EmptyState/
│   │   ├── EmptyState.tsx
│   │   ├── __tests__/
│   │   │   └── EmptyState.test.tsx
│   │   └── index.ts
│   ├── TraceTable/
│   │   ├── TraceTable.tsx
│   │   ├── TraceTableRow.tsx
│   │   ├── TraceTableHeader.tsx
│   │   ├── columns.ts
│   │   ├── __tests__/
│   │   │   ├── TraceTable.test.tsx
│   │   │   └── TraceTable.integration.test.tsx
│   │   └── index.ts
│   ├── TraceDrawer/
│   │   ├── TraceDrawer.tsx
│   │   ├── DrawerHeader.tsx
│   │   ├── tabs/
│   │   │   ├── SummaryTab.tsx
│   │   │   ├── SpanTab.tsx
│   │   │   └── index.ts
│   │   ├── __tests__/
│   │   │   └── TraceDrawer.test.tsx
│   │   └── index.ts
│   ├── FilterSidebar/
│   │   ├── FilterSidebar.tsx
│   │   ├── FacetSection.tsx
│   │   ├── __tests__/
│   │   │   └── FilterSidebar.test.tsx
│   │   └── index.ts
│   ├── SearchBar/
│   │   ├── SearchBar.tsx
│   │   ├── __tests__/
│   │   │   └── SearchBar.test.tsx
│   │   └── index.ts
│   └── DensityProvider.tsx          ← thin wrapper, no subdirectory needed
├── hooks/
│   ├── useTraceList.ts
│   ├── useTraceHeader.ts
│   ├── useSpanDetail.ts
│   ├── useTraceFacets.ts
│   ├── useTraceEvals.ts
│   ├── __tests__/
│   │   ├── useTraceList.test.ts
│   │   └── useTraceFacets.test.ts
│   └── index.ts
├── stores/
│   ├── filterStore.ts
│   ├── viewStore.ts
│   ├── drawerStore.ts
│   ├── uiStore.ts
│   ├── __tests__/
│   │   ├── filterStore.test.ts
│   │   └── viewStore.test.ts
│   └── index.ts
├── types/
│   ├── trace.ts
│   ├── span.ts
│   ├── filter.ts
│   ├── view.ts
│   └── index.ts
├── utils/
│   ├── filterAst.ts              ← filter AST builder/parser
│   ├── formatters.ts             ← duration, cost, token count formatting
│   └── index.ts
├── constants/
│   ├── staleTime.ts              ← TanStack Query stale times
│   ├── defaultViews.ts           ← built-in view presets
│   └── index.ts
└── docs/
    ├── STANDARDS.md               ← this file
    ├── prds/                      ← PRDs (what to build)
    └── decisions/                 ← ADRs
```

**Naming rules:**
- Component files: `PascalCase.tsx`
- Hook files: `camelCase.ts` (e.g., `useTraceList.ts`)
- Store files: `camelCase.ts` (e.g., `filterStore.ts`)
- Type files: `camelCase.ts` (e.g., `trace.ts`)
- Utility files: `camelCase.ts` (e.g., `formatters.ts`)
- Test files: `{SourceFile}.test.tsx` (unit), `{SourceFile}.integration.test.tsx` (integration)
- Index files: barrel exports only, no logic

---

## 2. React Patterns

### Components

```tsx
// ✅ Standard component pattern
interface TraceTableRowProps {
  trace: TraceListItem;
  isSelected: boolean;
  onSelect: (traceId: string) => void;
}

export const TraceTableRow: React.FC<TraceTableRowProps> = ({
  trace,
  isSelected,
  onSelect,
}) => {
  return (
    <Tr
      py="trace.rowPy"
      fontSize="trace.fontSm"
      bg={isSelected ? "orange.subtle" : undefined}
      _hover={{ bg: "bg.muted" }}
      cursor="pointer"
      onClick={() => onSelect(trace.traceId)}
    >
      {/* ... */}
    </Tr>
  );
};
```

**Rules:**
- Functional components only. No classes.
- Type with `React.FC<Props>` for explicit return type checking.
- Named exports. No default exports (except pages if required by router).
- Props interface named `{ComponentName}Props`, defined above the component.
- Destructure props in the function signature.
- `forwardRef` only when a parent needs direct DOM access.

### Use Standard Chakra Components

- **Always prefer off-the-shelf Chakra components** over custom implementations. Don't reimplement tabs, segmented controls, dropdowns, checkboxes, or tooltips.
- **Tabs:** Use `Tabs.Root` with `variant="subtle"` for inline tab bars (lens tabs), `variant="enclosed"` for panel-style tabs (drawer).
- **Segmented controls:** Use `SegmentGroup.Root` + `SegmentGroup.Indicator` + `SegmentGroup.Items` for toggle groups (density).
- **Buttons:** Use `Button variant="outline" size="xs"` for toolbar controls, not raw `Flex as="button"` with manual border styling.
- **Checkboxes:** Use `Checkbox.Root size="xs"` for compact filter checkboxes.
- **Tooltips:** Use the shared `Tooltip` component from `~/components/ui/tooltip`.
- **Colors:** Use semantic palette tokens (`red.fg`, `red.subtle`, `blue.fg/8`) not raw hex values or `red.400`/`red.500`. The `{color}.fg` token adapts to light/dark mode. Use `token/opacity` syntax for tints (e.g., `red.fg/4` for a 4% tint).

### Keep Components Small and Dumb

- **One component per file.** If a file has two components, the second one should be extracted to its own file.
- **Components are render-only.** No tRPC calls, no direct Zustand reads. All data comes via props or data hooks.
- **Extract logic to hooks.** If a component has more than ~5 lines of non-JSX logic (filtering, transforming, computing), pull it into a custom hook.
- **Break down large components.** If a component is over ~100 lines of JSX, decompose it into smaller sub-components in the same directory.
- **Event handlers:** `on{Event}` for props (e.g., `onSelect`), `handle{Event}` for internal handlers.

```tsx
// ❌ Too much logic in the component
export const TraceTable: React.FC<TraceTableProps> = () => {
  const ast = useFilterStore((s) => s.ast);
  const filters = astToApiFilter(ast);
  const { data } = api.tracesV2.list.useQuery({ filters });
  const sorted = useMemo(() => data?.sort(...), [data]);
  // 150 lines of JSX...
};

// ✅ Logic extracted, component is thin
export const TraceTable: React.FC<TraceTableProps> = () => {
  const { data, isLoading } = useTraceList();  // hook handles everything
  if (isLoading) return <TraceTableSkeleton />;
  if (!data?.length) return <EmptyState />;
  return <TraceTableBody traces={data} />;
};
```

### No Context. No Prop Drilling.

- **Do not use React Context** for state. Use Zustand stores instead. If you're reaching for `createContext`, you're probably doing something wrong. The only exception is Chakra's built-in providers.
- **Do not prop drill.** If a child 2+ levels deep needs state, it should read from a Zustand store via a data hook, not receive it as a prop passed through intermediaries.
- Components that need shared state call a hook. The hook reads from Zustand. The component never knows where the data came from.

```tsx
// ❌ Prop drilling
<Page density={density}>
  <Table density={density}>
    <Row density={density} />   // drilled 3 levels
  </Table>
</Page>

// ❌ Context
const DensityContext = createContext<Density>("comfortable");

// ✅ Zustand via CSS (for density specifically)
<DensityProvider>              {/* sets data-density attribute */}
  <Table>
    <Row />                    {/* uses trace.rowPy token, no prop needed */}
  </Table>
</DensityProvider>

// ✅ Zustand via hook (for other shared state)
export const TraceTableRow: React.FC<TraceTableRowProps> = ({ trace }) => {
  const { open } = useDrawerStore();  // reads from store, no prop drilling
  return <Tr onClick={() => open(trace.traceId)}>...</Tr>;
};
```

### Composition

- Prefer children-based composition over configuration props.
- Compound components (e.g., `Drawer.Header`, `Drawer.Body`) for complex multi-part UI.
- No render props unless a component genuinely needs caller-controlled rendering.

### Memoization

- `React.memo()` only on components that re-render frequently with unchanged props (e.g., table rows in a virtual list).
- `useMemo()` for expensive derived computations (filtering, sorting, tree building).
- `useCallback()` for handlers passed to memoized children.
- Don't pre-optimize. Measure first.

### Table Rendering Rules (from mock Phase 1 lessons)

These rules were discovered during the throwaway mock and prevent real bugs:

- **NEVER use two different rendering paths for table rows.** LLM rows and non-LLM
  rows MUST use the same TanStack `flexRender` with real `<td>` cells for the header
  line. I/O sub-rows go in a SEPARATE `<tr>` with `colSpan`.
- **Headers and body must use the same layout system.** `<th>` in `<thead>` and `<td>`
  in `<tbody>` of the same `<table>`. NEVER use `<td colSpan={N}>` wrapping a `<Flex>`
  to simulate columns.
- **Hover treats header line AND I/O sub-row as ONE unit.** Both `<tr>` elements
  share a hover state. Use a CSS group selector or shared hover class.
- **Drawer overlays the table, does not push/resize it.** The table renders at full
  width underneath the drawer. Use absolute/fixed positioning with box-shadow.

---

## 3. State Management

### Zustand — 4 Slices

Each slice owns one domain of user intent. Slices are separate stores, not a monolithic store.

```tsx
// stores/filterStore.ts
interface FilterState {
  ast: FilterNode;                    // source of truth for all filters
  setFilter: (field: string, value: FilterValue) => void;
  removeFilter: (field: string) => void;
  clearAll: () => void;
  setFromSearchString: (query: string) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  ast: emptyAst(),
  setFilter: (field, value) => set((s) => ({ ast: addFilter(s.ast, field, value) })),
  removeFilter: (field) => set((s) => ({ ast: removeFilter(s.ast, field) })),
  clearAll: () => set({ ast: emptyAst() }),
  setFromSearchString: (query) => set({ ast: parseSearchQuery(query) }),
}));
```

```tsx
// stores/viewStore.ts
interface ViewState {
  activeViewId: string;
  presetFilters: FilterNode[];          // locked filters owned by the active preset
  columns: ColumnConfig[];
  grouping: GroupingMode;
  sortOrder: SortConfig;
  setView: (viewId: string) => void;
  setColumns: (columns: ColumnConfig[]) => void;
  setGrouping: (mode: GroupingMode) => void;
  setSortOrder: (sort: SortConfig) => void;
}
```

```tsx
// stores/drawerStore.ts
interface DrawerState {
  isOpen: boolean;
  traceId: string | null;
  activeTab: DrawerTab;
  selectedSpanId: string | null;
  open: (traceId: string) => void;
  close: () => void;
  setTab: (tab: DrawerTab) => void;
  selectSpan: (spanId: string | null) => void;
}
```

```tsx
// stores/uiStore.ts
type Density = "compact" | "comfortable";

interface UiState {
  density: Density;
  sidebarCollapsed: boolean;
  setDensity: (d: Density) => void;
  toggleSidebar: () => void;
}
```

**Rules:**
- One store per slice. Not a single combined store.
- Immutable updates via `set()`.
- Actions are methods on the store interface, not separate functions.
- Selectors: subscribe to the narrowest slice possible (`useFilterStore(s => s.ast)`).
- No async logic in stores. Async lives in data hooks.

### Data Hooks (Adapter Pattern)

Each data hook reads intent from Zustand, constructs query params, and calls TanStack Query.
During mock phase, hooks return static data. During production phase, hooks call tRPC.
Components never know which phase they're in.

```tsx
// hooks/useTraceList.ts
export function useTraceList() {
  const ast = useFilterStore((s) => s.ast);
  const { columns, sortOrder, grouping } = useViewStore((s) => ({
    columns: s.columns,
    sortOrder: s.sortOrder,
    grouping: s.grouping,
  }));

  return api.tracesV2.list.useQuery(
    {
      filters: astToApiFilter(ast),
      columns: columns.map((c) => c.field),
      sort: sortOrder,
      grouping,
    },
    {
      staleTime: STALE_TIMES.traceList,       // 30s
      keepPreviousData: true,                  // smooth transitions on filter change
    }
  );
}
```

**Hook return type:** Every data hook returns the TanStack Query result shape:
`{ data, isLoading, isError, error, isFetching }`. Components consume this directly.

**Rules:**
- One hook per query endpoint.
- Hooks read from Zustand stores, not from props.
- Hooks never mutate stores. They read intent and return data.
- No data transformation in hooks beyond what the API requires. Format in the component or in utils.

---

## 4. Design Tokens

### Existing Semantic Tokens (use these, don't reinvent)

Foreground:
- `fg` — body text
- `fg.muted` — secondary text
- `fg.subtle` — tertiary text
- `fg.inverted` — text on dark backgrounds

Background:
- `bg.page` — outermost container
- `bg.surface` — main content area
- `bg.panel` — cards, panels
- `bg.muted` — hover states
- `bg.emphasized` — active/selected states
- `bg.subtle` — table headers, section backgrounds

Border:
- `border` — standard borders
- `border.muted` — subtle borders
- `border.subtle` — very subtle borders
- `border.emphasized` — strong borders

Status:
- `success` / `error` / `warning` / `pending` / `info` — semantic status colors

### Density Tokens (NEW — traces-v2)

Added as custom conditions in the Chakra system config.

```tsx
// Added to createSystem() in _app.tsx (or a traces-v2 theme extension)
conditions: {
  compact: "[data-density=compact] &",
  comfortable: "[data-density=comfortable] &",
},

semanticTokens: {
  sizes: {
    "trace.rowPy":     { value: { _compact: "4px",  _comfortable: "10px" } },
    "trace.cellPx":    { value: { _compact: "8px",  _comfortable: "12px" } },
    "trace.headerH":   { value: { _compact: "28px", _comfortable: "36px" } },
  },
  fontSizes: {
    "trace.sm":        { value: { _compact: "12px", _comfortable: "13px" } },
    "trace.xs":        { value: { _compact: "11px", _comfortable: "12px" } },
    "trace.xxs":       { value: { _compact: "10px", _comfortable: "11px" } },
  },
  spacing: {
    "trace.gapSm":     { value: { _compact: "4px",  _comfortable: "8px" } },
    "trace.gapMd":     { value: { _compact: "8px",  _comfortable: "12px" } },
  },
}
```

Usage in components:

```tsx
// DensityProvider.tsx — wraps the entire traces-v2 feature
export function DensityProvider({ children }: { children: React.ReactNode }) {
  const density = useUiStore((s) => s.density);
  return <Box data-density={density}>{children}</Box>;
}

// TraceTableRow.tsx — uses tokens, stays dumb
<Tr py="trace.rowPy" px="trace.cellPx" fontSize="trace.sm">
  {/* density resolves automatically via ancestor's data-density */}
</Tr>
```

### Span Type Colors

Consistent colors for span types across all views (table badges, drawer tree, waterfall).

```
llm         → blue.500      (primary AI operation)
tool        → green.500     (external tool/function call)
agent       → purple.500    (agent orchestration)
chain       → orange.500    (chain/pipeline)
rag         → teal.500      (retrieval)
evaluation  → yellow.500    (eval/scoring)
span        → gray.400      (generic span)
module      → cyan.500      (module/framework span)
```

Define as semantic tokens:

```tsx
semanticTokens: {
  colors: {
    "span.llm":        { value: { _light: "{colors.blue.500}",   _dark: "{colors.blue.400}" } },
    "span.tool":       { value: { _light: "{colors.green.500}",  _dark: "{colors.green.400}" } },
    "span.agent":      { value: { _light: "{colors.purple.500}", _dark: "{colors.purple.400}" } },
    "span.chain":      { value: { _light: "{colors.orange.500}", _dark: "{colors.orange.400}" } },
    "span.rag":        { value: { _light: "{colors.teal.500}",   _dark: "{colors.teal.400}" } },
    "span.evaluation": { value: { _light: "{colors.yellow.600}", _dark: "{colors.yellow.400}" } },
    "span.generic":    { value: { _light: "{colors.gray.400}",   _dark: "{colors.gray.500}" } },
    "span.module":     { value: { _light: "{colors.cyan.500}",   _dark: "{colors.cyan.400}" } },
  },
}
```

### Typography

| Context              | Font          | Size token    | Weight |
|----------------------|---------------|---------------|--------|
| Table body text      | Inter         | `trace.sm`    | 400    |
| Table header text    | Inter         | `trace.xs`    | 600    |
| Badge text           | Inter         | `trace.xxs`   | 500    |
| Code/data values     | JetBrains Mono| `trace.sm`    | 400    |
| Drawer headings      | Inter         | md (Chakra)   | 500    |
| Drawer body          | Inter         | sm (Chakra)   | 400    |
| Span I/O content     | JetBrains Mono| sm (Chakra)   | 400    |

Monospace font stack:
```
"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, Monaco, monospace
```

### Animation

| Action                  | Duration | Easing          | Library       |
|-------------------------|----------|-----------------|---------------|
| Drawer open/close       | 250ms    | ease-out        | motion/react  |
| Drawer content fade     | 150ms    | ease-in         | motion/react  |
| Row hover               | 100ms    | ease            | CSS transition|
| Tooltip enter           | 150ms    | ease-out        | CSS transition|
| Skeleton shimmer        | 1.4s     | linear (loop)   | CSS animation |
| Filter chip add/remove  | 150ms    | ease-out        | motion/react  |
| Confetti (onboarding)   | 2000ms   | —               | CSS particles |
| Density toggle reflow   | 0ms      | —               | instant (CSS) |

Use `motion/react` (Framer Motion) for enter/exit animations.
Use CSS transitions for hover/active/focus micro-interactions.
Density changes are instant — no transition (CSS vars update synchronously).

---

## 5. Spec Format

Specs live in `specs/traces-v2/`. Gherkin `.feature` files. Code-focused.

PRDs (in `docs/prds/`) describe WHAT to build: layout, content, behavior, design intent.
Specs (in `specs/traces-v2/`) describe HOW it works: component behavior, data contracts,
state transitions, acceptance criteria. Specs are the bridge between PRD and test code.

### File naming

```
specs/traces-v2/
├── onboarding-empty-state.feature    ← matches PRD-001
├── trace-table.feature               ← matches PRD-002
├── search-bar.feature                ← matches PRD-003
├── trace-drawer.feature              ← matches PRD-004
├── filter-sidebar.feature
├── density-toggle.feature
└── data-hooks/
    ├── trace-list.feature
    └── trace-facets.feature
```

Kebab-case filenames. One feature file per component or hook domain.

### Structure

```gherkin
Feature: Trace Table
  The primary data table rendering traces with configurable columns,
  density-aware sizing, and view-driven configuration.

  Background:
    Given the user has an active project with traces
    And the traces-v2 feature flag is enabled
    And the active view is "All Traces"

  # ── Rendering ─────────────────────────────────────────

  @unit
  Scenario: Render rows from useTraceList data
    Given useTraceList returns 25 traces
    When the TraceTable renders
    Then 25 rows are visible
    And each row shows: time, name, duration, cost, tokens, model

  @unit
  Scenario: Empty state when no traces exist
    Given useTraceList returns 0 traces
    When the TraceTable renders
    Then the EmptyState component is shown
    And the table headers are hidden

  # ── Interaction ───────────────────────────────────────

  @unit
  Scenario: Click row opens drawer
    Given the table has rendered with traces
    When the user clicks trace row "trace-123"
    Then drawerStore.open is called with "trace-123"

  @unit
  Scenario: Density affects row sizing
    Given the density is "compact"
    When the TraceTable renders
    Then row padding resolves to 4px vertical
    And font size resolves to 12px

  # ── Data ──────────────────────────────────────────────

  @integration
  Scenario: Filter change triggers refetch
    Given the table is showing "All Traces"
    When the user adds a filter "status:error"
    Then useTraceList refetches with the updated AST
    And the table shows only error traces
```

### Tags

- `@unit` — tests one component in isolation (mock all hooks)
- `@integration` — tests multiple components or hook+store interaction
- `@visual` — snapshot or screenshot comparison test
- `@a11y` — accessibility-specific scenario

### Writing guidelines

- One scenario per behavior. Not one scenario per user story.
- Given = state setup. When = user action or data change. Then = observable result.
- Reference specific store methods and hook names (e.g., `drawerStore.open`, `useTraceList`).
- Include data contracts: "useTraceList returns 25 traces" not just "there are traces."
- Include density scenarios for every density-aware component.

---

## 6. Test Standards

### Directory structure

All tests in `__tests__/` directories within the component/hook/store directory.

```
components/TraceTable/__tests__/
  TraceTable.test.tsx               ← unit
  TraceTable.integration.test.tsx   ← integration

hooks/__tests__/
  useTraceList.test.ts              ← unit

stores/__tests__/
  filterStore.test.ts               ← unit
```

### Naming conventions

- Unit: `{SourceFile}.test.tsx`
- Integration: `{SourceFile}.integration.test.tsx`
- Test descriptions: `describe("{ComponentName}")` → `it("renders rows from hook data")`

### Framework

- **Vitest** (matches existing codebase)
- **@testing-library/react** for component tests
- **@testing-library/user-event** for interaction simulation
- **Fishery** factories for test data generation

### What to test

| Layer      | What to test                                    | What NOT to test           |
|------------|-------------------------------------------------|---------------------------|
| Components | Renders correct output for given props/hook data| Internal Chakra styling    |
|            | Calls correct handlers on interaction           | CSS property values        |
|            | Handles loading/error/empty states              | Exact DOM structure        |
| Hooks      | Returns correct data shape                      | tRPC internals             |
|            | Reads correct Zustand selectors                 | Network layer              |
|            | Constructs correct query params from store state|                           |
| Stores     | State transitions (set/update/clear)            | Zustand internals          |
|            | Action methods produce correct next state       | Persistence (if any)       |
| Utils      | Pure function input/output                      |                           |

### Test data factories

```tsx
// factories/trace.factory.ts
import { Factory } from "fishery";
import type { TraceListItem } from "../types";

export const traceFactory = Factory.define<TraceListItem>(({ sequence }) => ({
  traceId: `trace-${sequence}`,
  timestamp: Date.now() - sequence * 60_000,
  name: `agent.run.${sequence}`,
  duration: 1200 + sequence * 100,
  cost: 0.003 * sequence,
  tokens: 1200 + sequence * 50,
  model: "openai/gpt-4o",
  hasError: sequence % 5 === 0,
  spanCount: 3 + (sequence % 10),
  serviceName: "finance-bot",
}));

// Usage
const traces = traceFactory.buildList(25);
const errorTrace = traceFactory.build({ hasError: true, name: "failed.run" });
```

### Hook testing pattern

```tsx
// hooks/__tests__/useTraceList.test.ts
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useTraceList } from "../useTraceList";

// Mock the stores
vi.mock("../../stores/filterStore", () => ({
  useFilterStore: vi.fn((selector) => selector({ ast: emptyAst() })),
}));

vi.mock("../../stores/viewStore", () => ({
  useViewStore: vi.fn((selector) =>
    selector({
      columns: defaultColumns,
      sortOrder: { field: "timestamp", dir: "desc" },
      grouping: "flat",
    })
  ),
}));

describe("useTraceList", () => {
  it("passes filter AST and view config to the query", () => {
    const { result } = renderHook(() => useTraceList());
    // Assert query was called with correct params derived from store state
  });
});
```

---

## 7. Cross-Cutting Conventions

### Error handling

- Components show error states from hook results: `if (isError) return <ErrorBanner />`
- No try/catch in components. Errors surface through TanStack Query's error state.
- Domain errors in tRPC routers mapped to TRPCError codes (existing pattern).
- React Error Boundary at the feature root for unexpected crashes.

### Loading states

- Skeleton loading for initial load (Chakra's Skeleton component).
- `isFetching` indicator for background refetches (subtle, not full skeleton).
- `keepPreviousData: true` on list queries for smooth filter transitions.

### Keyboard navigation

- All interactive elements focusable via Tab.
- Enter/Space to activate buttons and checkboxes.
- Arrow keys for table row navigation.
- Escape to close drawer.
- `/` to focus search bar.
- Documented in PRD-011 (Accessibility).

### Imports

- Absolute imports from the feature root: `~/features/traces-v2/...`
- Relative imports within a component directory: `./TraceTableRow`
- Barrel exports (`index.ts`) at each directory level for public API.
- Internal files (not re-exported) are private to that directory.
