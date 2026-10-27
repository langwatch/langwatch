import {
  Badge,
  ConfirmButton,
  IconButton,
  IconRefresh,
  KeyValue,
  Panel,
  Section,
  Select,
  Stack,
} from "@langwatch/design-system-internal";
import {
  SimCode,
  SimConsole,
  SimEmpty,
  SimList,
  SimRefusal,
  SimSplit,
  type SimStatus,
  SimTime,
  useSimPoll,
} from "@langwatch/sim-console";
import { useState } from "react";

import {
  type Call,
  clearCalls,
  fetchCall,
  fetchCalls,
  fetchInfo,
  setForcedError,
} from "./lambda-api.ts";

const errorLabel = (kind: string) => (kind === "" ? "None: run on nlpgo" : kind);

const consoleStatus = ({
  failure,
  forced,
  target,
}: {
  failure?: string;
  forced: string;
  target?: string;
}): SimStatus => {
  if (failure) return { tone: "error", text: failure };
  if (forced) return { tone: "warn", text: `Every invoke fails as ${forced}` };
  return { tone: "ok", text: `Invocations run on nlpgo at ${target ?? "…"}` };
};

/** One invocation: its facts, then the event lambdasim received and what nlpgo answered. */
const CallDetail = ({ call, bodies }: { call: Call; bodies?: Call }) => (
  <article data-testid="call-detail">
    <Stack gap={4}>
      <Panel
        title={`${call.method} ${call.path}`}
        meta={
          call.functionError ? (
            <Badge tone="error">{call.functionError}</Badge>
          ) : (
            <Badge>{call.status}</Badge>
          )
        }
      >
        <KeyValue
          items={[
            { label: "Function", value: call.function },
            { label: "Mode", value: call.mode, mono: false, copy: false },
            {
              label: "Duration",
              value: `${call.durationMs.toFixed(0)} ms`,
              mono: false,
              copy: false,
            },
            ...(call.error ? [{ label: "Error", value: call.error, mono: false }] : []),
          ]}
        />
      </Panel>
      <Panel title="Event">
        <SimCode text={bodies?.request ?? "…"} language="json" />
      </Panel>
      <Panel title="nlpgo answer">
        <SimCode text={bodies?.response || "(empty)"} />
      </Panel>
    </Stack>
  </article>
);

/** The NLP Lambda simulator's console: recent invocations and the forced error. */
export const CallsConsole = () => {
  const info = useSimPoll({ fetch: fetchInfo });
  const calls = useSimPoll({ fetch: fetchCalls });
  const [selectedId, setSelectedId] = useState("");
  const items = calls.data ?? [];
  const selected = items.find((call) => call.id === selectedId) ?? items[0];
  const detail = useSimPoll({
    fetch: () => (selected ? fetchCall(selected.id) : Promise.resolve(undefined)),
  });
  const bodies = detail.data?.id === selected?.id ? detail.data : undefined;
  const failure = info.error ?? calls.error;
  const forced = info.data?.settings.forcedError ?? "";
  const clear = async () => {
    await clearCalls().catch(() => undefined);
    await calls.refresh();
  };
  const force = async (kind: string) => {
    await setForcedError(kind).catch(() => undefined);
    await info.refresh();
  };

  return (
    <SimConsole
      sim="lambda"
      title="Lambda"
      stackSlug={info.data?.stack ?? ""}
      tabs={[]}
      activeTab=""
      onTab={() => undefined}
      status={consoleStatus({ failure: failure?.message, forced, target: info.data?.target })}
    >
      <Section
        title="Invocations"
        description="Every per-project NLP Lambda invoke this stack makes runs here on the local nlpgo; nothing reaches AWS."
        actions={
          <>
            <Select
              label="Forced error"
              hideLabel
              options={(info.data?.forcedErrors ?? [""]).map((kind) => ({
                value: kind,
                label: errorLabel(kind),
              }))}
              value={forced}
              onChange={(kind) => void force(kind)}
            />
            <ConfirmButton
              label="Clear calls"
              confirmLabel="Clear all"
              disabled={items.length === 0}
              onConfirm={() => void clear()}
            />
          </>
        }
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
                renderRow={(call) => <span data-testid="call-row">{call.path}</span>}
                rowDescription={(call) =>
                  `${call.function} · ${call.mode} · ${call.functionError || call.status}`
                }
                rowMeta={(call) => <SimTime at={call.at} />}
                empty={
                  <SimEmpty
                    title="No invocations yet"
                    hint="Run a workflow in the studio and its Lambda invoke lands here."
                  />
                }
              />
            }
            detail={selected ? <CallDetail call={selected} bodies={bodies} /> : undefined}
            emptyDetail={
              <Panel>
                <SimEmpty
                  title="Select an invocation"
                  hint="Its event and nlpgo's answer open here."
                />
              </Panel>
            }
          />
        )}
      </Section>
    </SimConsole>
  );
};
