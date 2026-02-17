import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";

interface TenantContinuePromptProps {
  nextTenantId: string;
  nextProjectInfo: { name: string; slug: string } | null;
  onContinue: () => void;
  onAbort: () => void;
}

export function TenantContinuePrompt({
  nextTenantId,
  nextProjectInfo,
  onContinue,
  onAbort,
}: TenantContinuePromptProps) {
  const display = nextProjectInfo
    ? `${nextProjectInfo.name} (${nextTenantId})`
    : nextTenantId;

  const items = [
    { label: `Continue to next tenant: ${display}`, value: "continue" as const },
    { label: "Abort (skip remaining tenants)", value: "abort" as const },
  ];

  const handleSelect = (item: { value: string }) => {
    if (item.value === "continue") {
      onContinue();
    } else {
      onAbort();
    }
  };

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>{"━".repeat(50)}</Text>
      <SelectInput items={items} onSelect={handleSelect} />
    </Box>
  );
}
