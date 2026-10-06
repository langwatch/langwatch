import {
  Badge,
  Code,
  EmptyState,
  List,
  ListItem,
  Panel,
  Section,
} from "@langwatch/design-system-internal";
import {
  SimConsole,
  SimEmpty,
  SimRefusal,
  SimSplit,
  SimTime,
  useSimPoll,
} from "@langwatch/sim-console";
import { type ReactNode, useState } from "react";

import { CallDetailPane } from "./call-detail.tsx";
import { type Call, fetchCalls, fetchInfo } from "./llm-api.ts";
import { SettingsPanel } from "./settings-panel.tsx";

const CALLS_TAB = "calls";
const SETTINGS_TAB = "settings";

const NoCalls = () => (
  <Panel>
    <EmptyState
      title="No calls yet"
      description={
        <>
          Start the stack with <Code>haven up +llm</Code> so every provider points here, then send a
          playground message, run an evaluator or ask Langy. Each model call lands in this list.
        </>
      }
    />
  </Panel>
);

const CallList = ({
  calls,
  selectedId,
  onSelect,
}: {
  calls: Call[];
  selectedId: string;
  onSelect: (id: string) => void;
}) => (
  <Panel title="Calls" meta={String(calls.length)}>
    <List label="Recent calls">
      {calls.map((call) => (
        <ListItem
          key={call.id}
          current={call.id === selectedId}
          onSelect={() => onSelect(call.id)}
          title={call.model || call.path}
          description={`${call.dialect} · ${call.inputTokens} in, ${call.outputTokens} out · ${Math.round(call.latencyMs)} ms`}
          meta={
            <>
              <Badge tone={call.status === 200 ? "ok" : "error"}>{call.status}</Badge>{" "}
              <SimTime at={call.at} />
            </>
          }
        />
      ))}
    </List>
  </Panel>
);

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
    body = (
      <Section
        title="Settings"
        description="What every call follows unless it sends its own X-Llmsim-* header."
      >
        {info.data ? (
          <SettingsPanel info={info.data} onSaved={() => void info.refresh()} />
        ) : (
          <SimEmpty title="Loading settings" />
        )}
      </Section>
    );
  } else {
    let content: ReactNode;
    if (calls.error) content = <SimRefusal message={calls.error.message} />;
    else if (items.length === 0) content = <NoCalls />;
    else
      content = (
        <SimSplit
          list={<CallList calls={items} selectedId={selected?.id ?? ""} onSelect={setSelectedId} />}
          detail={selected ? <CallDetailPane id={selected.id} /> : undefined}
        />
      );
    body = (
      <Section
        title="Calls"
        description="Every model call this stack makes is answered here, free and repeatable. Nothing reaches a real provider."
      >
        {content}
      </Section>
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
