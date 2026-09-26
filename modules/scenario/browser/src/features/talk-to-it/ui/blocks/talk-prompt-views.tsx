import { Button, Input, Link, Text, VStack } from "@chakra-ui/react";

import type { TalkState } from "../../model/talk-to-it-machine.ts";

/** The settings route that adds a model provider key (mirrors the drawer). */
const MODEL_PROVIDERS_ROUTE = "/settings/model-providers";

export function NeedsNameView({
  state,
  pendingName,
  setPendingName,
  onSave,
}: {
  state: Extract<TalkState, { kind: "needsName" }>;
  pendingName: string;
  setPendingName: (value: string) => void;
  onSave: (args: { isCutAtLimit: boolean; name: string }) => void;
}) {
  return (
    <VStack align="stretch" gap={2} data-testid="talk-needs-name">
      <Text>Name this agent to save the call</Text>
      <Input
        value={pendingName}
        onChange={(e) => setPendingName(e.target.value)}
        placeholder="Enter agent name"
        data-testid="talk-name-input"
      />
      <Button
        colorPalette="blue"
        disabled={pendingName.trim().length === 0}
        onClick={() => onSave({ isCutAtLimit: state.isCutAtLimit, name: pendingName.trim() })}
        data-testid="talk-name-save"
      >
        Save
      </Button>
    </VStack>
  );
}

export function ErrorView({
  state,
  onRetry,
}: {
  state: Extract<TalkState, { kind: "error" }>;
  onRetry: () => void;
}) {
  return (
    <VStack align="stretch" gap={2} data-testid="talk-error">
      <Text color="fg.error">{state.message}</Text>
      {state.code === "key_missing" && (
        <Link href={MODEL_PROVIDERS_ROUTE} color="blue.fg" data-testid="talk-add-key">
          Add key
        </Link>
      )}
      <Button variant="outline" onClick={onRetry} data-testid="talk-retry">
        Retry
      </Button>
    </VStack>
  );
}
