import { KeyValue, Panel, Section, Stack } from "@langwatch/design-system-internal";
import { SimCode, SimEmpty, SimRefusal } from "@langwatch/sim-console";

import type { ViewProps } from "./view-props.ts";

const commands = `haven sim telemetry send --preset llm-trace --seed 42 --json
haven sim telemetry load --rate 50 --duration 30s
haven sim telemetry post --preset logs --encoding json
haven sim telemetry list | get <id> | fixtures | status | stop | console`;

/** Where runs go, whose key they carry (never the key itself) and the terminal verbs. */
export const SetupView = ({ status, error }: ViewProps) => (
  <Section
    title="Setup"
    description="haven gives the sim this stack's OTLP door and seeded project key, so nothing here needs a key."
  >
    <Stack gap={4}>
      {error && status === undefined ? (
        <SimRefusal message={error.message} />
      ) : (
        <Panel title="Target">
          {status?.endpoint ? (
            <KeyValue
              items={[
                { label: "Stack", value: status.stack || "none" },
                { label: "OTLP base", value: status.endpoint },
                {
                  label: "API key",
                  value: status.keyHint
                    ? `${status.keyHint} (from ${status.keySource ?? "the sim's config"})`
                    : "none",
                  copy: false,
                },
                { label: "Project", value: status.project || "the key's project" },
              ]}
            />
          ) : (
            <SimEmpty
              title="No default target"
              hint="Started without haven: every run and send must name an endpoint and apiKey."
            />
          )}
        </Panel>
      )}
      <Panel title="From a terminal">
        <SimCode text={commands} language="shell" />
      </Panel>
    </Stack>
  </Section>
);
