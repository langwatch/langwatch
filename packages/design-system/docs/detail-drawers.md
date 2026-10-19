# Entity detail drawers

Use these patterns for an entity's identity, properties, related resources and
activity. They are presentational: feature code owns queries, permissions,
resolved names, event labels and event-to-icon mapping. The SSO connection drawer
in `modules/ops/browser/src/features/admin/ui/sections/` is the first consumer.

| Export                                               | Component                        | Responsibility                                                                                         |
| ---------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `@langwatch/design-system/detail-drawer-header`      | `DetailDrawerHeader`             | Kind and decorative icon, accessible entity title, wrapping context/badge row                          |
| `@langwatch/design-system/summary-list`              | `SummaryList`, `SummaryListItem` | Semantic description list; missing, null and empty-string values read as `—`                           |
| `@langwatch/design-system/resource-row`              | `ResourceRow`                    | Resource icon/name, status, description and provenance slots                                           |
| `@langwatch/design-system/activity-timeline`         | `ActivityTimeline`               | Stable-ID entries sorted newest first, grouped by local calendar day, with icons and exact-time hovers |
| `@langwatch/design-system/formatted-date` (existing) | `FormattedDate`                  | `display="relative"` gives a live age and a focusable exact-time tooltip                               |

Each new component has an adjacent autodocs story and component test. Storybook's
colour-mode switch exercises the same semantic tokens in light and dark mode.
The stories include narrow or long content and each component's relevant empty,
pending, loading and error states. The existing Formatted date / Relative story
covers the time primitive; there is no second relative-time formatter.

```tsx
import { DetailDrawerHeader } from "@langwatch/design-system/detail-drawer-header";
import { Drawer } from "@langwatch/design-system/drawer";
import { Badge } from "@langwatch/design-system/primitives";
import { SummaryList, SummaryListItem } from "@langwatch/design-system/summary-list";

<Drawer.Header>
  <DetailDrawerHeader kind="Person" title={person.name}>
    <span>{organization.name}</span>
    <Badge colorPalette="green">Active</Badge>
  </DetailDrawerHeader>
</Drawer.Header>;

<SummaryList>
  <SummaryListItem label="Email">{person.email}</SummaryListItem>
  <SummaryListItem label="Role">
    <Badge>Administrator</Badge>
  </SummaryListItem>
</SummaryList>;
```

`DetailDrawerHeader` goes inside `Drawer.Header`; it supplies `Drawer.Title`, not
another header container. The caller retains the drawer size, padding, close
control and focus policy. Put section headings outside `SummaryList`.
`ResourceRow` is not clickable by default; use the `name` slot for a link when
navigation is needed. Keep names and status text meaningful without the icons.

```tsx
import { ActivityTimeline } from "@langwatch/design-system/activity-timeline";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { ResourceRow } from "@langwatch/design-system/resource-row";

<ResourceRow
  name={domain.name}
  status={<Badge colorPalette="green">Verified</Badge>}
  description="Published record"
  meta={
    <>
      Verified by {person.name} · {person.email} ·
      <FormattedDate value={domain.verifiedAtMs} display="relative" />
    </>
  }
/>;

<ActivityTimeline
  title="History"
  entries={events.map((event) => ({
    id: event.id,
    occurredAtMs: event.occurredAtMs,
    content: event.summary,
    icon: event.icon,
  }))}
  emptyState="Nothing has happened yet."
/>;
```

Timeline inputs use epoch milliseconds and unique stable IDs. Input order is not
mutated. `icon` is decorative and falls back to a circle; `content` must explain
the event. `meta` can carry additional badges. `timeZone` defaults to the viewer's
zone and applies to both day grouping and displayed times; `locale` controls date
formatting. Day headings are Today, Yesterday or the formatted date.

For loading or failure, pass no entries and supply a skeleton or error message as
`emptyState`. The feature decides whether to retain stale data. Relative timestamps
refresh through `FormattedDate`; calendar groups are recalculated on render.
Do not use the timeline as a workflow stepper or a future schedule.
