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

import { CallTimeline } from "./call-timeline.tsx";
import { fetchCalls, fetchStatus } from "./voice-api.ts";

const CALLS_TAB = "calls";

/** The voice simulator's console: recent simulated calls, each with its turn timeline. */
export const CallsConsole = () => {
  const status = useSimPoll({ fetch: fetchStatus });
  const calls = useSimPoll({ fetch: fetchCalls });
  const [selectedId, setSelectedId] = useState("");
  const items = calls.data ?? [];
  const selected = items.find((call) => call.id === selectedId) ?? items[0];
  const failure = status.error ?? calls.error;

  return (
    <SimConsole
      sim="voice"
      title="Voice"
      stackSlug={status.data?.stack ?? ""}
      tabs={[{ id: CALLS_TAB, label: "Calls", count: items.length }]}
      activeTab={CALLS_TAB}
      // One tab, so there is nothing to switch to.
      onTab={() => undefined}
      status={
        failure
          ? { tone: "error", text: failure.message }
          : { tone: "ok", text: `ElevenLabs at ${status.data?.elevenLabsBaseUrl ?? "…"}` }
      }
    >
      {calls.error ? (
        <SimRefusal message={calls.error.message} />
      ) : (
        <SimSplit
          list={
            <SimList
              items={items}
              rowKey={(call) => call.id}
              selectedKey={selected?.id}
              onSelect={setSelectedId}
              renderRow={(call) => (
                <span className="voice-row" data-testid="call-row">
                  <strong>{call.agentId || call.id}</strong>
                  <span>
                    {call.turns.length} turns · {call.endedAt ? "ended" : "live"}
                  </span>
                  <SimTime at={call.startedAt} />
                </span>
              )}
              empty={
                <SimEmpty
                  title="No calls yet"
                  hint="Run a scenario against a voice agent; its calls land here."
                />
              }
            />
          }
          detail={selected ? <CallTimeline call={selected} /> : undefined}
          emptyDetail={<SimEmpty title="No call selected" hint="Pick a call to see its turns." />}
        />
      )}
    </SimConsole>
  );
};
