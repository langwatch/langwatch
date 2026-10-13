# Suite Workflow — UI Mockups

Reference mockups for issue #1397. Based on design screenshots (Feb 2026).

---

## 1. Suites Page — Empty State

```
┌──────────────────────────────────────────────────────────────────────────┐
│  N  new customer project ▾   >  Simulations  >  Runs           🔍 Search│
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SUITES                  «│                                              │
│  ┌──────────────────────┐ │                                              │
│  │ 🔍 Search...         │ │       Select a suite or create one           │
│  ├──────────────────────┤ │                                              │
│  │ + New Suite           │ │                                              │
│  ├──────────────────────┤ │                                              │
│  │ ≡ All Runs            │ │                                              │
│  │                       │ │                                              │
│  │  (no suites yet)      │ │                                              │
│  │                       │ │                                              │
│  └──────────────────────┘ │                                              │
│                            │                                              │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Suites Page — Suite Selected

When a suite is selected in the sidebar, the main area shows:

1. Suite header (name, labels, description, Edit + Run buttons)
2. Stats chips row
3. Last activity timestamp
4. Filter bar
5. Run history list (collapsible rows — each row is a **run**)
6. Footer totals

```
┌──────────────────────────────────────────────────────────────────────────┐
│  N  new customer project ▾   >  Simulations  >  Runs           🔍 Search│
├──────────────────────────────────────────────────────────────────────────┤
│  SUITES                  «│                                              │
│  ┌──────────────────────┐ │  Critical Path   [regression] [critical]     │
│  │ 🔍 Search...         │ │  Core user journeys that must   ✏ Edit ▶ Run│
│  ├──────────────────────┤ │  pass before deploy                          │
│  │ + New Suite           │ │                                              │
│  ├──────────────────────┤ │  ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ ≡ All Runs            │ │  │📄 8    │ │◎ 1     │ │🔁 3×   │           │
│  ├──────────────────────┤ │  │scenario│ │targets │ │trials  │           │
│  │                       │ │  └────────┘ └────────┘ └────────┘           │
│  │  Quick Run       ▶Run │ │  ┌────────┐ ┌────────┐ ┌──────────────┐   │
│  │  ✓ 1/1 · 5m ago      │ │  │≡ 42    │ │📊 127  │ │✓ 100% pass   │   │
│  │                       │ │  │execu-  │ │runs    │ │  (+3%)       │   │
│  │ ┌ Critical Path  ▶Run│ │  │tions   │ │        │ │              │   │
│  │ │ ✓ 8/8 · 2h ago     │ │  └────────┘ └────────┘ └──────────────┘   │
│  │ └ (selected)          │ │                                              │
│  │                       │ │  🕐 2h ago                                   │
│  │  Billing Edge    ▶Run │ │                                              │
│  │  ✗ 9/12 · 1d ago     │ │  Scenario ▾  Target ▾  Pass/Fail ▾          │
│  │                       │ │                          Group by: None ▾    │
│  │  All Scenario... ▶Run │ │                                              │
│  │  ✗ 45/48 · 3h ago    │ │  ▼ 2 hours ago  ·  ✓ 100%            Manual │
│  │                       │ │  ┌──────────────────────────────────────┐   │
│  └──────────────────────┘ │  │ ✓ Angry refund × Prod Agent          │   │
│                            │  │              100% (3/3)  2.3s        │   │
│                            │  │ ✓ Policy violation × Prod Agent      │   │
│                            │  │              100% (3/3)  1.8s        │   │
│                            │  │ ✓ Confused user × Prod Agent         │   │
│                            │  │              100% (3/3)  3.1s        │   │
│                            │  │ ✓ Edge: empty cart × Prod Agent      │   │
│                            │  │              100% (3/3)  2.0s        │   │
│                            │  │ ✓ Billing dispute × Prod Agent       │   │
│                            │  │              100% (3/3)  2.5s        │   │
│                            │  └──────────────────────────────────────┘   │
│                            │                                              │
│                            │  ▸ 1 day ago  ·  ✗ 88%              Webhook │
│                            │                                              │
│                            │  3 runs              21 passed   3 failed   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Sidebar item anatomy

```
┌──────────────────────────┐
│  Suite Name         ▶ Run│     ▶ = play icon + "Run" link
│  ✓ 8/8 passed · 2h ago  │     Status: ✓ all pass / ✗ some fail
└──────────────────────────┘
```

---

## 3. New Suite Drawer

Opened via "+ New Suite" button. Slides in from right.

```
                            ┌──────────────────────────────────────────┐
                            │  New Suite                           [×] │
                            ├──────────────────────────────────────────┤
                            │                                          │
                            │  Name *                                  │
                            │  ┌──────────────────────────────────────┐│
                            │  │ e.g., Critical Path Suite            ││
                            │  └──────────────────────────────────────┘│
                            │                                          │
                            │  Description (optional)                  │
                            │  ┌──────────────────────────────────────┐│
                            │  │ Core journeys that must pass before  ││
                            │  │ deploy                               ││
                            │  └──────────────────────────────────────┘│
                            │                                          │
                            │  Labels                                  │
                            │  [+ add]                                 │
                            │                                          │
                            │  Scenarios *                             │
                            │  ┌──────────────────────────────────────┐│
                            │  │ 🔍 Search scenarios...               ││
                            │  ├──────────────────────────────────────┤│
                            │  │ [All] [#critical] [#billing] [#edge] ││
                            │  │ [#sales] [#support]                  ││
                            │  ├──────────────────────────────────────┤│
                            │  │ + New Scenario                       ││
                            │  │ ☐ Angry refund request    #critical  ││
                            │  │                           #billing   ││
                            │  │ ☐ Policy violation esc.   #critical  ││
                            │  │ ☐ Confused user clarif.   #critical  ││
                            │  │ ☐ Edge: empty cart        #edge      ││
                            │  ├──────────────────────────────────────┤│
                            │  │ 0 of 8 selected    Select All  Clear ││
                            │  └──────────────────────────────────────┘│
                            │                                          │
                            │  Target(s) *                             │
                            │  ┌──────────────────────────────────────┐│
                            │  │ 🔍 Search targets...                 ││
                            │  ├──────────────────────────────────────┤│
                            │  │ + New Target                         ││
                            │  │ ☐ Production Agent      (HTTP)      ││
                            │  │ ☐ Support Bot v2        (Prompt)    ││
                            │  │ ☐ Claude Sonnet         (HTTP)      ││
                            │  ├──────────────────────────────────────┤│
                            │  │ 0 of 3 selected    Select All  Clear ││
                            │  └──────────────────────────────────────┘│
                            │                                          │
                            │  ▸ Execution Options                     │
                            │  ▸ Triggers                              │
                            │                                          │
                            ├──────────────────────────────────────────┤
                            │                   [Save]   [▶ Run Now]  │
                            └──────────────────────────────────────────┘
```

### Execution Options (expanded)

```
                            │  ▾ Execution Options                     │
                            │  ┌──────────────────────────────────────┐│
                            │  │  Repeat count                        ││
                            │  │  ┌─────┐                             ││
                            │  │  │  3  │  times per scenario×target  ││
                            │  │  └─────┘                             ││
                            │  └──────────────────────────────────────┘│
```

---

## 4. Edit Suite Drawer

Same as New Suite but pre-populated. Title says "Edit Suite". Opened via:

- Edit button in suite header
- "Edit" in context menu

```
                            ┌──────────────────────────────────────────┐
                            │  Edit Suite                          [×] │
                            ├──────────────────────────────────────────┤
                            │  (same fields as New Suite,              │
                            │   pre-populated with existing values)    │
                            │                                          │
                            ├──────────────────────────────────────────┤
                            │                   [Save]   [▶ Run Now]  │
                            └──────────────────────────────────────────┘
```

---

## 5. Suite Context Menu (right-click on sidebar item)

```
│  All Scenario... ▶ Run │
│  ✗ 45/48 · 3h ago     │
│  ┌───────────────┐     │
│  │ Edit           │     │
│  │ Duplicate      │     │
│  │ Delete (red)   │     │
│  └───────────────┘     │
```

---

## 6. Run History List

The main content area below the suite header and filter bar. Each row
represents a **run** (not individual scenario×target pairs). Runs are
collapsible — expanding shows the scenario × target breakdown as a
summary preview. Clicking a run navigates to the existing run detail page.

### Collapsed run

```
┌────────────────────────────────────────────────────────────────────┐
│ ▸ 1 day ago  ·  ✗ 88%                                   Webhook  │
└────────────────────────────────────────────────────────────────────┘
```

### Expanded run (most recent is expanded by default)

```
┌────────────────────────────────────────────────────────────────────┐
│ ▼ 2 hours ago  ·  ✓ 100%                                  Manual │
├────────────────────────────────────────────────────────────────────┤
│ ✓ Angry refund × Prod Agent              100% (3/3)   2.3s       │
│ ✓ Policy violation × Prod Agent           100% (3/3)   1.8s       │
│ ✓ Confused user × Prod Agent              100% (3/3)   3.1s       │
│ ✓ Edge: empty cart × Prod Agent           100% (3/3)   2.0s       │
│ ✓ Billing dispute × Prod Agent            100% (3/3)   2.5s       │
└────────────────────────────────────────────────────────────────────┘
```

### Run row header anatomy

```
[chevron] [relative_time]  ·  [status_icon] [pass_rate]     [trigger_type]
```

### Scenario × target row anatomy (inside expanded run)

```
[status_icon] [scenario_name] × [target_name]    [pass%] ([pass/total])  [duration]
```

Where:

- `status_icon`: ✓ (green) for all pass, ✗ (red) for any fail
- `pass%`: percentage of repeat trials that passed
- `(pass/total)`: e.g. (3/3) when repeatCount=3
- `duration`: average execution time
- `trigger_type`: Manual, Webhook, etc.

### Footer

```
  3 runs                                         21 passed   3 failed
```

---

## 7. Stats Chips

Horizontal row of stat chips shown in the suite header area.

```
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────┐
│📄 8    │ │◎ 1     │ │🔁 3×   │ │≡ 42    │ │📊 127  │ │✓ 100% pass   │
│scenario│ │targets │ │trials  │ │execu-  │ │runs    │ │  (+3%)       │
│        │ │        │ │        │ │tions   │ │        │ │              │
└────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └──────────────┘
```

- **scenarios**: count of scenarioIds in suite config
- **targets**: count of target refs in suite config
- **trials**: repeatCount value (e.g. "3×")
- **executions**: total scenario×target×repeat jobs ever run
- **runs**: total suite runs triggered
- **pass rate**: overall pass percentage with delta from previous run
