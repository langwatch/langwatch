import { Button, CodeBlock, Inline, Panel, Select, Text } from "@langwatch/design-system-internal";
import { useState } from "react";

import type { StackHome } from "../shared/contract.ts";

export type SeedPanelProps = {
  seed: StackHome["seed"];
  busy: boolean;
  onSeed: (choice: { size: string; persona: string }) => void;
};

const options = (values: string[]) => values.map((value) => ({ value, label: value }));

/** The seed console: `haven db seed` at a chosen size and persona, with its progress. */
export const SeedPanel = ({ seed, busy, onSeed }: SeedPanelProps) => {
  const [size, setSize] = useState(seed.sizes[0] ?? "tiny");
  const [persona, setPersona] = useState(seed.personas[0] ?? "all");
  const running = seed.status.startsWith("seed: running");
  return (
    <Panel
      title="Seed"
      meta={seed.status === "" ? "Never seeded" : seed.status.replace(/^seed: /, "")}
    >
      <Inline>
        <Select label="Size" options={options(seed.sizes)} value={size} onChange={setSize} />
        <Select
          label="Persona"
          options={options(seed.personas)}
          value={persona}
          onChange={setPersona}
        />
        <Button
          variant="primary"
          disabled={!seed.canSeed || running || busy}
          loading={busy}
          onClick={() => onSeed({ size, persona })}
        >
          Seed
        </Button>
      </Inline>
      {!seed.canSeed && <Text>Start the stack to seed it.</Text>}
      {seed.log.length > 0 && <CodeBlock code={seed.log.join("\n")} label="Seed log" wrap />}
    </Panel>
  );
};
