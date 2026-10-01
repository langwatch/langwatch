import {
  SimConsole,
  SimEmpty,
  SimList,
  SimRefusal,
  SimSplit,
  SimTime,
  useSimPoll,
} from "@langwatch/sim-console";
import { type ReactNode, useState } from "react";

import { CallDetailPane } from "./call-detail.tsx";
import { fetchCalls, fetchInfo } from "./llm-api.ts";
import { SettingsPanel } from "./settings-panel.tsx";

const CALLS_TAB = "calls";
const SETTINGS_TAB = "settings";

/** The LLM simulator's console: recent model calls with their detail, and the switches. */
export const LlmConsole = () => {
  const info = useSimPoll({ fetch: fetchInfo });
  const calls = useSimPoll({ fetch: fetchCalls });
  const [tab, setTab] = useState(CALLS_TAB);
  const [selectedId, setSelectedId] = useState("");
  const items = calls.data ?? [];
  const selected = items.find((call) => call.id === selectedId) ?? items[0];
  const failure = info.error ?? calls.error;
  const forced = info.data?.settings.forcedError ?? 0;

  let status: { tone: "error" | "warn" | "ok"; text: string };
  if (failure) status = { tone: "error", text: failure.message };
  else if (forced) status = { tone: "warn", text: `Every call answers ${forced}` };
  else status = { tone: "ok", text: "Answering every model call" };
  let body: ReactNode;
  if (tab === SETTINGS_TAB) {
    body = info.data ? (
      <SettingsPanel settings={info.data.settings} onSaved={() => void info.refresh()} />
    ) : (
      <SimEmpty title="Loading settings" />
    );
  } else if (calls.error) {
    body = <SimRefusal message={calls.error.message} />;
  } else {
    body = (
      <SimSplit
        list={
          <SimList
            items={items}
            rowKey={(call) => call.id}
            selectedKey={selected?.id}
            onSelect={setSelectedId}
            renderRow={(call) => (
              <span className="llm-row" data-testid="call-row">
                <strong>{call.model || call.path}</strong>
                <span>
                  {call.status === 200 ? call.mode : `${call.status} forced`}
                  {call.stream ? " · streamed" : ""} · {call.inputTokens}+{call.outputTokens} tokens
                  · {Math.round(call.latencyMs)} ms
                </span>
                <SimTime at={call.at} />
              </span>
            )}
            empty={
              <SimEmpty
                title="No calls yet"
                hint="Send a playground message, run an evaluator or talk to Langy; its model calls land here."
              />
            }
          />
        }
        detail={selected ? <CallDetailPane id={selected.id} /> : undefined}
        emptyDetail={
          <SimEmpty title="No call selected" hint="Pick a call to see its request and reply." />
        }
      />
    );
  }

  return (
    <SimConsole
      sim="llm"
      title="LLM"
      stackSlug={info.data?.stack ?? ""}
      tabs={[
        { id: CALLS_TAB, label: "Calls", count: items.length },
        { id: SETTINGS_TAB, label: "Settings" },
      ]}
      activeTab={tab}
      onTab={setTab}
      status={status}
    >
      {body}
    </SimConsole>
  );
};
