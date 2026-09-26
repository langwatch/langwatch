/**
 * The browser call panel: idle → connecting → live → saving → done, with mic, mint and fetch
 * failures surfaced as the AC copy. It opens the call through the transport client registry.
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { HStack, Spinner, Text, VStack } from "@chakra-ui/react";

import { useTalkToItCall } from "../../behavior/use-talk-to-it-call.ts";
import { getVoiceTransportClient } from "../../behavior/voice-transport-client.registry.ts";
import { CONSENT_NOTICE } from "../../model/talk-to-it-machine.ts";
import {
  PHONE_NO_BROWSER_CALL_NOTICE,
  type TalkToItPanelProps,
} from "../../model/talk-to-it-props.ts";
import { DoneView, LiveView } from "../blocks/talk-call-views.tsx";
import { ErrorView, NeedsNameView } from "../blocks/talk-prompt-views.tsx";

/** A phone target is dialled from a scenario run, so it shows the notice and never mints. */
export function TalkToItPanel(props: TalkToItPanelProps) {
  if (!getVoiceTransportClient(props.transport)) {
    return (
      <VStack align="stretch" gap={4} data-testid="talk-to-it-panel">
        <Text fontSize="sm" color="fg.muted" data-testid="talk-phone-no-browser-notice">
          {PHONE_NO_BROWSER_CALL_NOTICE}
        </Text>
      </VStack>
    );
  }
  return <BrowserCallPanel {...props} />;
}

function BusyLine({ label }: { label: string }) {
  return (
    <HStack gap={2}>
      <Spinner size="sm" />
      <Text>{label}</Text>
    </HStack>
  );
}

function BrowserCallPanel(props: TalkToItPanelProps) {
  const call = useTalkToItCall(props);
  const { state } = call;

  return (
    <VStack align="stretch" gap={4} data-testid="talk-to-it-panel">
      {(state.kind === "idle" || state.kind === "connecting") && (
        <Text fontSize="sm" color="fg.muted" data-testid="talk-consent-notice">
          {CONSENT_NOTICE}
        </Text>
      )}
      {state.kind === "connecting" && <BusyLine label="Connecting" />}
      {state.kind === "live" && (
        <LiveView
          state={state}
          micLevel={call.micLevel}
          onHangUp={() => call.endCall(false)}
          maxSeconds={call.maxSeconds}
        />
      )}
      {state.kind === "saving" && <BusyLine label="Saving the call" />}
      {state.kind === "needsName" && (
        <NeedsNameView
          state={state}
          pendingName={call.pendingName}
          setPendingName={call.setPendingName}
          onSave={call.saveWithName}
        />
      )}
      {state.kind === "done" && <DoneView state={state} runHref={call.runHref} />}
      {state.kind === "error" && <ErrorView state={state} onRetry={() => void call.start()} />}
    </VStack>
  );
}
