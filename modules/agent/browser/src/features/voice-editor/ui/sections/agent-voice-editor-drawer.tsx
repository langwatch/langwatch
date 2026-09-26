/**
 * The voice agent editor. The credential lives on the project's ElevenLabs
 * provider row, never on the agent, so the drawer only says whether it exists.
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { HStack, Spinner, Text } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";

import {
  useVoiceAgentEditor,
  type AgentVoiceEditorDrawerProps,
  type VoiceAgentEditor,
} from "../../behavior/use-voice-agent-editor.ts";
import { addKeyHref } from "../../model/voice-talk.ts";
import { VoiceAgentFooter } from "../blocks/voice-agent-footer.tsx";
import { VoiceAgentForm } from "../blocks/voice-agent-form.tsx";
import { VoiceAgentHeader } from "../blocks/voice-agent-header.tsx";
import { VoiceAgentTalkView } from "./voice-agent-talk-view.tsx";

function VoiceAgentBody({ editor }: { editor: VoiceAgentEditor }) {
  if (editor.isTalkOpen) return <VoiceAgentTalkView editor={editor} />;
  if (editor.isLoading) {
    return (
      <HStack justify="center" paddingY={8}>
        <Spinner size="md" />
      </HStack>
    );
  }
  return (
    <VoiceAgentForm
      form={editor.form}
      onChange={editor.change}
      hasTwilioKey={editor.hasTwilioKey}
      hasElevenLabsKey={editor.hasElevenLabsKey}
      hasAttemptedSubmit={editor.hasAttemptedSubmit}
      addKeyHref={addKeyHref(globalThis.location?.href)}
    />
  );
}

export function AgentVoiceEditorDrawer(props: AgentVoiceEditorDrawerProps) {
  const editor = useVoiceAgentEditor(props);
  const header = (
    <VoiceAgentHeader
      canGoBack={editor.canGoBack}
      onGoBack={editor.goBack}
      isEditing={Boolean(editor.agentId)}
    />
  );

  return (
    <Drawer.Root
      open={editor.isOpen}
      onOpenChange={({ open }) => !open && editor.close()}
      size="lg"
      closeOnInteractOutside={!editor.isEnabled}
      modal={false}
      preventScroll={false}
    >
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        {header}
        {editor.isEnabled ? (
          <>
            <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
              <VoiceAgentBody editor={editor} />
            </Drawer.Body>
            <VoiceAgentFooter
              isSaved={Boolean(editor.savedAgentId)}
              transport={editor.form.transport}
              voiceAgentId={editor.form.voiceAgentId}
              hasElevenLabsKey={editor.hasElevenLabsKey}
              isSaving={editor.isSaving}
              onCancel={editor.close}
              onTalk={editor.openTalk}
              onSave={editor.save}
            />
          </>
        ) : (
          <Drawer.Body padding={6}>
            <Text data-testid="voice-agents-disabled-message">
              Voice agents are not enabled for this project.
            </Text>
          </Drawer.Body>
        )}
      </Drawer.Content>
    </Drawer.Root>
  );
}
