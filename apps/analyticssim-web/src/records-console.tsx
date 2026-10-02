import {
  ConfirmButton,
  IconButton,
  IconRefresh,
  Inline,
  Input,
  Panel,
  Section,
  Select,
  Stack,
} from "@langwatch/design-system-internal";
import {
  SimConsole,
  SimEmpty,
  SimList,
  SimRefusal,
  SimSplit,
  SimTime,
  useSimPoll,
} from "@langwatch/sim-console";
import { useState } from "react";

import { clearRecords, fetchRecords, fetchStatus, kinds, providers } from "./analytics-api.ts";
import { providerLabel, RecordDetail } from "./record-detail.tsx";

const ALL = "all";
const kindOptions = [
  { value: "", label: "Every kind" },
  ...kinds.map((kind) => ({ value: kind, label: kind })),
];

/** The analytics simulator's console: every PostHog and Customer.io call, newest first. */
export const RecordsConsole = () => {
  const status = useSimPoll({ fetch: fetchStatus });
  const records = useSimPoll({ fetch: fetchRecords });
  const [provider, setProvider] = useState(ALL);
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const all = records.data ?? [];
  const needle = query.trim().toLowerCase();
  const inTab = all.filter((record) => provider === ALL || record.provider === provider);
  const items = inTab.filter(
    (record) =>
      (kind === "" || record.kind === kind) &&
      (needle === "" || `${record.name ?? ""} ${record.distinctId}`.toLowerCase().includes(needle)),
  );
  const selected = items.find((record) => record.id === selectedId) ?? items[0];
  const failure = status.error ?? records.error;
  const clear = async () => {
    await clearRecords().catch(() => undefined);
    await records.refresh();
  };

  return (
    <SimConsole
      sim="analytics"
      title="Analytics"
      stackSlug={status.data?.stack ?? ""}
      tabs={[
        { id: ALL, label: "All", count: all.length },
        ...providers.map((id) => ({
          id,
          label: providerLabel[id],
          count: all.filter((record) => record.provider === id).length,
        })),
      ]}
      activeTab={provider}
      onTab={setProvider}
      status={
        failure
          ? { tone: "error", text: failure.message }
          : { tone: "ok", text: `PostHog and Customer.io at ${status.data?.baseUrl ?? "…"}` }
      }
      actions={
        <ConfirmButton
          label="Clear records"
          confirmLabel="Clear all"
          disabled={all.length === 0}
          onConfirm={() => void clear()}
        />
      }
    >
      <Section
        title="Records"
        description="Every PostHog and Customer.io call this stack makes lands here and is never sent on to the vendor."
      >
        <Stack gap={4}>
          <Inline gap={3} wrap>
            <div className="analytics-search">
              <Input
                label="Search records"
                hideLabel
                type="search"
                placeholder="Event name or distinct id"
                autoComplete="off"
                value={query}
                onChange={setQuery}
              />
            </div>
            <div className="analytics-kind">
              <Select
                label="Kind"
                hideLabel
                options={kindOptions}
                value={kind}
                onChange={setKind}
              />
            </div>
          </Inline>
          {records.error ? (
            <SimRefusal message={records.error.message} />
          ) : (
            <SimSplit
              list={
                <SimList
                  title="Records"
                  meta={
                    items.length === inTab.length
                      ? String(items.length)
                      : `${items.length} of ${inTab.length}`
                  }
                  actions={
                    <IconButton
                      label="Refresh"
                      icon={<IconRefresh />}
                      size="sm"
                      onClick={() => void records.refresh()}
                    />
                  }
                  items={items}
                  rowKey={(record) => record.id}
                  selectedKey={selected?.id}
                  onSelect={setSelectedId}
                  renderRow={(record) => (
                    <span data-testid="record-row">{record.name || record.kind}</span>
                  )}
                  rowDescription={(record) =>
                    `${providerLabel[record.provider]} · ${record.kind} · ${record.distinctId || "(no id)"}`
                  }
                  rowMeta={(record) => <SimTime at={record.receivedAt} />}
                  empty={
                    all.length === 0 ? (
                      <SimEmpty
                        title="No records yet"
                        hint="Browse the app on a stack started with haven up +analytics; its PostHog and Customer.io calls land here."
                      />
                    ) : (
                      <SimEmpty
                        title="No records match"
                        hint="Try another provider, kind or search."
                      />
                    )
                  }
                />
              }
              detail={selected ? <RecordDetail record={selected} /> : undefined}
              emptyDetail={
                <Panel>
                  <SimEmpty
                    title="Select a record"
                    hint="Its facts, properties and the raw call open here."
                  />
                </Panel>
              }
            />
          )}
        </Stack>
      </Section>
    </SimConsole>
  );
};
