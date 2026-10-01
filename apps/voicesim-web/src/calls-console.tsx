import { IconButton, IconRefresh, Panel, Section } from "@langwatch/design-system-internal";
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

/** The voice simulator's console: recent simulated calls, each with its conversation. */
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
      tabs={[]}
      activeTab=""
      onTab={() => undefined}
      status={
        failure
          ? { tone: "error", text: failure.message }
          : { tone: "ok", text: `ElevenLabs at ${status.data?.elevenLabsBaseUrl ?? "…"}` }
      }
    >
      <Section
        title="Calls"
        description="Every voice-agent call this stack places is answered here by a scripted agent; nothing reaches ElevenLabs or OpenAI."
      >
        {calls.error ? (
          <SimRefusal message={calls.error.message} />
        ) : (
          <SimSplit
            list={
              <SimList
                title="Calls"
                meta={String(items.length)}
                actions={
                  <IconButton
                    label="Refresh"
                    icon={<IconRefresh />}
                    size="sm"
                    onClick={() => void calls.refresh()}
                  />
                }
                items={items}
                rowKey={(call) => call.id}
                selectedKey={selected?.id}
                onSelect={setSelectedId}
                renderRow={(call) => <span data-testid="call-row">{call.agentId || call.id}</span>}
                rowDescription={(call) =>
                  `${call.turns.length} turns · ${call.endedAt ? "ended" : "live"}`
                }
                rowMeta={(call) => <SimTime at={call.startedAt} />}
                empty={
                  <SimEmpty
                    title="No calls yet"
                    hint="Talk to a voice agent in the app and its call lands here."
                  />
                }
              />
            }
            detail={selected ? <CallTimeline call={selected} /> : undefined}
            emptyDetail={
              <Panel>
                <SimEmpty
                  title="Select a call"
                  hint="Its facts, transcript and protocol events open here."
                />
              </Panel>
            }
          />
        )}
      </Section>
    </SimConsole>
  );
};
