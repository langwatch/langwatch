import {
  Button,
  Callout,
  Code,
  CodeBlock,
  EmptyState,
  Grid,
  Panel,
  Stack,
  Tabs,
  Text,
} from "@langwatch/design-system-internal";

import { browserLanePath, getJson } from "../../shared/api.ts";
import {
  browserSnapshotSchema,
  browserStatusSchema,
  cliReadSchema,
} from "../../shared/contract.ts";
import { useCliRead } from "../../shared/use-cli-rows.ts";
import { usePoll } from "../../shared/use-poll.ts";

const SCREENSHOT_MS = 3000;

/** One lane: the snapshot an agent reads, and a screenshot retaken on each snapshot. */
const LanePanel = ({ slug, lane }: { slug: string; lane: string }) => {
  const snapshot = usePoll({
    key: `${slug}/${lane}/snapshot`,
    intervalMs: SCREENSHOT_MS,
    load: async ({ signal }) => {
      const answer = await getJson({
        path: browserLanePath({ slug, lane, view: "snapshot" }),
        schema: cliReadSchema({ rows: browserSnapshotSchema }),
        signal,
      });
      return answer.rows;
    },
  });
  return (
    <Grid columns={2}>
      <Panel
        title="Screenshot"
        meta={snapshot.data?.url}
        actions={
          <Button size="sm" onClick={() => void snapshot.refresh()}>
            Refresh
          </Button>
        }
      >
        <img
          className="haven-lane-screenshot"
          alt={`What lane ${lane} shows now`}
          src={`${browserLanePath({ slug, lane, view: "screenshot" })}?at=${snapshot.updatedAt ?? 0}`}
        />
      </Panel>
      <Panel title="Snapshot" meta={snapshot.data?.title}>
        {snapshot.error !== undefined && snapshot.data === undefined ? (
          <Text tone="muted">{snapshot.error}</Text>
        ) : (
          <CodeBlock code={snapshot.data?.snapshot ?? "Reading the page…"} />
        )}
      </Panel>
    </Grid>
  );
};

/** The Browser tab: `haven browser status`, and each open lane's page. */
export const BrowserTab = ({
  slug,
  sub,
  onSub,
}: {
  slug: string;
  sub: string;
  onSub: (sub: string) => void;
}) => {
  const status = useCliRead({ slug, name: "browser", rows: browserStatusSchema });
  const lanes = status.data?.lanes ?? [];
  if (status.error !== undefined && status.data === undefined) {
    return (
      <Callout tone="error" title="The browser could not be read">
        {status.error}
      </Callout>
    );
  }
  if (lanes.length === 0) {
    return (
      <Panel>
        <EmptyState
          title={status.data?.running === true ? "No lane is open" : "No browser is running"}
          description={
            <>
              Open one with <Code>haven browser open --lane &lt;name&gt; --as admin</Code>; its page
              shows up here.
            </>
          }
        />
      </Panel>
    );
  }
  const lane = lanes.includes(sub) ? sub : (lanes[0] ?? "");
  return (
    <Stack gap={4}>
      <Tabs
        label="Browser lanes"
        tabs={lanes.map((name) => ({ id: name, label: name }))}
        value={lane}
        onChange={onSub}
      />
      <LanePanel key={lane} slug={slug} lane={lane} />
    </Stack>
  );
};
