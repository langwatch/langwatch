import { Button, Inline, Input, Panel, Select, Stack } from "@langwatch/design-system-internal";
import { SimRefusal } from "@langwatch/sim-console";
import { useState } from "react";

import {
  clients,
  flows,
  scenarioBlock,
  transports,
  type Flow,
  type RunRequest,
  type Scenario,
  type Transport,
} from "./mcp-api.ts";

const flowOptions = flows.map((flow) => ({ value: flow, label: flow }));
const transportOptions = transports.map((transport) => ({ value: transport, label: transport }));
const clientOptions = clients.map((client) => ({ value: client, label: client }));

const isFlow = (value: string): value is Flow => flows.some((flow) => flow === value);
const isTransport = (value: string): value is Transport =>
  transports.some((transport) => transport === value);

/** oauth-connect has its own panel in Setup, since it needs a mode and a person. */
const startable = (scenario: Scenario) => scenario.name !== "oauth-connect";

/** A whole number above zero, or a refusal naming the field; an empty field is not 0. */
const countOf = ({ value, label }: { value: string; label: string }) => {
  const count = Number(value);
  if (value.trim() === "" || !Number.isInteger(count) || count < 1) {
    throw new Error(`${label} takes a whole number of 1 or more.`);
  }
  return count;
};

/** Only the fields a scenario reads go on the wire; the sim fills the rest. */
const extrasOf = ({
  scenario,
  hold,
  idle,
  soakClients,
  duration,
}: {
  scenario: string;
  hold: string;
  idle: string;
  soakClients: string;
  duration: string;
}) => {
  if (scenario === "stream") {
    return { holdSeconds: countOf({ value: hold, label: "Hold seconds" }) };
  }
  if (scenario === "idle") {
    return { idleSeconds: countOf({ value: idle, label: "Idle seconds" }) };
  }
  if (scenario === "soak") {
    return { clients: countOf({ value: soakClients, label: "Clients" }), duration };
  }
  return {};
};

/** One button per scenario, with the settings it reads. */
export const StartRunForm = ({
  scenarios,
  connected,
  onStart,
}: {
  scenarios: Scenario[];
  connected: boolean;
  onStart: (args: { request: RunRequest }) => Promise<unknown>;
}) => {
  const [flow, setFlow] = useState<Flow>("apikey");
  const [transport, setTransport] = useState<Transport>("/mcp");
  const [client, setClient] = useState("claude-code");
  const [hold, setHold] = useState("60");
  const [idle, setIdle] = useState("30");
  const [soakClients, setSoakClients] = useState("10");
  const [duration, setDuration] = useState("1m");
  const [busy, setBusy] = useState("");
  const [refusal, setRefusal] = useState("");

  const start = async (scenario: string) => {
    setBusy(scenario);
    setRefusal("");
    try {
      await onStart({
        request: {
          scenario,
          flow,
          client,
          transport,
          ...extrasOf({ scenario, hold, idle, soakClients, duration }),
        },
      });
    } catch (caught) {
      setRefusal(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  };

  return (
    <Panel title="Start a scenario">
      <Stack gap={3}>
        <Inline gap={3} wrap>
          <Select
            label="Flow"
            options={flowOptions}
            value={flow}
            onChange={(value) => isFlow(value) && setFlow(value)}
          />
          <Select
            label="Transport"
            options={transportOptions}
            value={transport}
            onChange={(value) => isTransport(value) && setTransport(value)}
          />
          <Select label="Client" options={clientOptions} value={client} onChange={setClient} />
          <Input
            label="Hold seconds (stream)"
            type="number"
            min={1}
            value={hold}
            onChange={setHold}
          />
          <Input
            label="Idle seconds (idle)"
            type="number"
            min={1}
            value={idle}
            onChange={setIdle}
          />
          <Input
            label="Clients (soak)"
            type="number"
            min={1}
            value={soakClients}
            onChange={setSoakClients}
          />
          <Input label="Duration (soak)" value={duration} onChange={setDuration} />
        </Inline>
        <Inline gap={2} wrap>
          {scenarios.filter(startable).map((scenario) => {
            const block = scenarioBlock({ scenario, flow, connected });
            return (
              <Button
                key={scenario.name}
                disabled={block !== "" || busy !== ""}
                loading={busy === scenario.name}
                title={block || scenario.summary}
                onClick={() => void start(scenario.name)}
              >
                {scenario.name}
              </Button>
            );
          })}
        </Inline>
        {refusal !== "" && <SimRefusal message={refusal} />}
      </Stack>
    </Panel>
  );
};
