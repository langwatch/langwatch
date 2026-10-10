import {
  Badge,
  Button,
  Inline,
  Input,
  KeyValue,
  Panel,
  Section,
  Stack,
} from "@langwatch/design-system-internal";
import {
  SimEmpty,
  SimJson,
  SimList,
  SimRefusal,
  SimSplit,
  useSimPoll,
} from "@langwatch/sim-console";
import { useEffect, useState } from "react";

import { SendOneAnswerPanel } from "./send-one-answer.tsx";
import {
  fetchFixture,
  fetchFixtures,
  sendOne,
  type Fixture,
  type SendOneAnswer,
  type SendOneRequest,
} from "./telemetry-api.ts";

/** One fixture's body, from a seed for a preset, and a button that sends it to the door. */
const FixtureDetail = ({ fixture }: { fixture: Fixture }) => {
  const [seed, setSeed] = useState("1");
  const seedNumber = Number(seed) || 0;
  const body = useSimPoll({
    fetch: () => fetchFixture({ name: fixture.name, seed: seedNumber }),
    everyMs: 60_000,
  });
  const { refresh } = body;
  useEffect(() => {
    void refresh();
  }, [refresh, seedNumber]);
  const [answer, setAnswer] = useState<SendOneAnswer>();
  const [refusal, setRefusal] = useState("");
  const send = async () => {
    setRefusal("");
    const request: SendOneRequest =
      fixture.kind === "preset"
        ? { preset: fixture.name, seed: seedNumber, encoding: "protobuf" }
        : { fixture: fixture.name, encoding: "protobuf" };
    await sendOne({ request })
      .then(setAnswer)
      .catch((caught: unknown) =>
        setRefusal(caught instanceof Error ? caught.message : String(caught)),
      );
  };

  return (
    <article data-testid="fixture-detail">
      <Stack gap={4}>
        <Panel title={fixture.name} meta={<Badge>{fixture.kind}</Badge>}>
          <Stack gap={3}>
            <KeyValue
              items={[
                { label: "Signal", value: fixture.signal, copy: false },
                ...(fixture.service ? [{ label: "service.name", value: fixture.service }] : []),
                ...(fixture.family ? [{ label: "Family", value: fixture.family }] : []),
                ...(body.data?.bytes
                  ? [{ label: "JSON bytes", value: String(body.data.bytes), copy: false }]
                  : []),
              ]}
            />
            <Inline gap={3} wrap>
              {fixture.kind === "preset" && (
                <Input label="Seed" type="number" min={0} value={seed} onChange={setSeed} />
              )}
              <Button variant="primary" onClick={() => void send()}>
                Send to the door
              </Button>
            </Inline>
            {refusal !== "" && <SimRefusal message={refusal} />}
          </Stack>
        </Panel>
        {answer && <SendOneAnswerPanel answer={answer} />}
        {body.error ? (
          <SimRefusal message={body.error.message} />
        ) : (
          body.data && <SimJson value={body.data.body} label="OTLP JSON body" />
        )}
      </Stack>
    </article>
  );
};

/** The presets telemetrysim synthesizes and the scrubbed recordings under its fixtures/. */
export const FixturesView = () => {
  const fixtures = useSimPoll({ fetch: fetchFixtures, everyMs: 60_000 });
  const [selectedName, setSelectedName] = useState("");
  const items = fixtures.data ?? [];
  const selected = items.find((fixture) => fixture.name === selectedName) ?? items[0];

  return (
    <Section
      title="Fixtures"
      description="Presets build a batch from a seed; recordings are scrubbed exports of real agents under services/telemetrysim/fixtures."
    >
      {fixtures.error ? (
        <SimRefusal message={fixtures.error.message} />
      ) : (
        <SimSplit
          list={
            <SimList
              title="Fixtures"
              meta={String(items.length)}
              items={items}
              rowKey={(fixture) => fixture.name}
              selectedKey={selected?.name}
              onSelect={setSelectedName}
              renderRow={(fixture) => <span data-testid="fixture-row">{fixture.name}</span>}
              rowDescription={(fixture) =>
                `${fixture.kind} · ${fixture.signal}${fixture.service ? ` · ${fixture.service}` : ""}`
              }
              empty={<SimEmpty title="No fixtures" hint="The sim reported none." />}
            />
          }
          detail={selected ? <FixtureDetail key={selected.name} fixture={selected} /> : undefined}
          emptyDetail={
            <Panel>
              <SimEmpty title="Select a fixture" hint="Its OTLP JSON body opens here." />
            </Panel>
          }
        />
      )}
    </Section>
  );
};
