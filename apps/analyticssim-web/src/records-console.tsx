import { ConfirmButton, Select } from "@langwatch/design-system-internal";
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
  const [selectedId, setSelectedId] = useState("");
  const all = records.data ?? [];
  const items = all.filter(
    (record) =>
      (provider === ALL || record.provider === provider) && (kind === "" || record.kind === kind),
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
        <>
          <Select
            label="Kind"
            hideLabel
            size="sm"
            options={kindOptions}
            value={kind}
            onChange={setKind}
          />
          <ConfirmButton
            label="Clear"
            confirmLabel="Clear all records"
            size="sm"
            onConfirm={() => void clear()}
          />
        </>
      }
    >
      {records.error ? (
        <SimRefusal message={records.error.message} />
      ) : (
        <SimSplit
          list={
            <SimList
              items={items}
              rowKey={(record) => record.id}
              selectedKey={selected?.id}
              onSelect={setSelectedId}
              renderRow={(record) => (
                <span className="analytics-row" data-testid="record-row">
                  <strong>{record.name || record.kind}</strong>
                  <span>
                    {providerLabel[record.provider]} · {record.kind} ·{" "}
                    {record.distinctId || "(no id)"}
                  </span>
                  <SimTime at={record.receivedAt} />
                </span>
              )}
              empty={
                <SimEmpty
                  title="No records yet"
                  hint="Use the product with haven up +analytics; PostHog and Customer.io calls land here."
                />
              }
            />
          }
          detail={selected ? <RecordDetail record={selected} /> : undefined}
          emptyDetail={<SimEmpty title="No record selected" hint="Pick a record to see it." />}
        />
      )}
    </SimConsole>
  );
};
