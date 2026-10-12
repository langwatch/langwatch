import { KeyValue, Panel } from "@langwatch/design-system-internal";
import { SimTime } from "@langwatch/sim-console";

import type { AnalyticsActivity } from "./analytics-api.ts";

/** How busy the stack's app has been: the hub's numbers, seeded samples left out. */
export const ActivityPanel = ({ activity }: { activity: AnalyticsActivity }) => (
  <Panel title="Activity" meta="seeded samples left out">
    <div data-testid="activity">
      <KeyValue
        items={[
          { label: "Last five minutes", value: String(activity.lastFiveMinutes), copy: false },
          { label: "Distinct ids", value: String(activity.distinctIds), copy: false },
          { label: "Since start", value: String(activity.total), copy: false },
          {
            label: "Last call",
            value: activity.lastReceivedAt ? (
              <>
                {activity.lastName} <SimTime at={activity.lastReceivedAt} />
              </>
            ) : (
              "none yet"
            ),
            mono: false,
            copy: false,
          },
        ]}
      />
    </div>
  </Panel>
);
