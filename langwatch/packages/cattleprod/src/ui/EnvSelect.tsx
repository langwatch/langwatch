import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { ENVIRONMENTS, type Environment } from "../lib/environments.js";

interface EnvSelectProps {
  onSelect: (env: Environment) => void;
}

export const EnvSelect: React.FC<EnvSelectProps> = ({ onSelect }) => {
  const items = Object.entries(ENVIRONMENTS).map(([key, config]) => ({
    label: `${config.name} - ${config.description}`,
    value: key as Environment,
  }));

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          🐄⚡ Cattleprod - Select Environment
        </Text>
      </Box>
      <SelectInput
        items={items}
        onSelect={(item) => onSelect(item.value)}
      />
      <Box marginTop={1}>
        <Text dimColor>Use arrow keys to select, Enter to confirm</Text>
      </Box>
    </Box>
  );
};
