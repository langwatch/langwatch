# Feature icons and colors

Every product feature / resource type (datasets, workflows, prompts,
evaluations, traces, agents, ...) has ONE canonical icon + color in
`src/utils/featureIcons.ts`
(`featureIcons: Record<FeatureKey, { icon, color, label }>`). Use it everywhere
a feature is represented; do not pick an icon or color ad hoc.

```tsx
import { featureIcons } from "~/utils/featureIcons";

const { icon: Icon, color, label } = featureIcons["datasets"];
<Icon size={14} color={color} /> {label}
```

This keeps the sidebar, quick-access links, recent items, and any new surface in
sync. Adding a feature means adding one entry here, and everything that renders
it picks up the icon and color.

## Rendering them neutral

Some surfaces want the feature icon but not its brand color. The plan-limit
upgrade dialog (`UpgradeModal`) lists the resources behind a limit as small
badges that take their icon from `featureIcons` but render everything gray
(`colorPalette="gray"`, lucide icons inherit `currentColor`), so the badges read
as quiet references rather than colorful chips. Take the icon from
`featureIcons`; override the color locally when the surface calls for it.

## Limit dialog: per-project breakdown

The upgrade dialog counts resources org-wide, so its usage ("4 / 3") can look
wrong from inside a single project. Below the usage it lists the counted
resources grouped by project as gray `featureIcons` badges, each linking to the
resource. The data comes from `licenseEnforcement.getLimitBreakdown`
(`getLimitBreakdownByProject`), which mirrors the count repository's RLS-safe
pattern (resolve the org's project ids, then `projectId in`). A limit type
becomes listable by adding it to `BREAKDOWN_LIMIT_TYPES` and the `resourceHref`
switch in `UpgradeModal`. Limit types with no listable per-project resources
(members, teams, ...) simply render no breakdown.
