import { Code, Grid, KeyValue, Panel, Stack, Text } from "@langwatch/design-system-internal";

import type { StackHome } from "../../shared/contract.ts";
import { CredentialsPanel } from "../credentials-panel.tsx";
import { SeedPanel } from "../seed-panel.tsx";

const withPort = ({ name, port }: { name: string; port: number }) =>
  name === "" ? "—" : `${name} :${port}`;

/** The DB tab: `haven db url|seed|logins` for this stack. */
export const DbTab = ({
  home,
  seeding,
  onSeed,
}: {
  home: StackHome;
  seeding: boolean;
  onSeed: (choice: { size: string; persona: string }) => void;
}) => {
  const { postgres, clickhouse } = home.facts.databases;
  return (
    <Stack gap={4}>
      <Grid columns={2}>
        <Panel title="Databases">
          <Stack gap={3}>
            <KeyValue
              items={[
                {
                  label: "Postgres",
                  value: withPort(postgres),
                  copy: postgres.name === "" ? false : postgres.name,
                },
                {
                  label: "ClickHouse",
                  value: withPort(clickhouse),
                  copy: clickhouse.name === "" ? false : clickhouse.name,
                },
              ]}
            />
            <Text tone="muted">
              Connection URLs: <Code>haven db url</Code>
            </Text>
          </Stack>
        </Panel>
        <CredentialsPanel credentials={home.credentials} />
      </Grid>
      <SeedPanel seed={home.seed} busy={seeding} onSeed={onSeed} />
    </Stack>
  );
};
