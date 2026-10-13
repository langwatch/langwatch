/**
 * The voice agent editor. The credential lives on the project's ElevenLabs
 * provider row, never on the agent, so the drawer only says whether it exists.
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { Drawer } from "@langwatch/design-system/drawer";
import { Text } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";

import {
  useVoiceAgentEditor,
  type AgentVoiceEditorDrawerProps,
  type VoiceAgentEditor,
} from "../../behavior/use-voice-agent-editor.ts";
import { addKeyHref, talkTooltipFor } from "../../model/voice-talk.ts";
import { VoiceAgentForm } from "../blocks/voice-agent-form.tsx";
import { VoiceAgentTalkView } from "./voice-agent-talk-view.tsx";

function VoiceAgentBody({ editor }: { editor: VoiceAgentEditor }) {
  if (editor.isTalkOpen) return <VoiceAgentTalkView editor={editor} />;
  if (editor.isLoading) {
    return <SkeletonRows rows={4} />;
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
  const prerequisites = {
    transport: editor.form.transport,
    voiceAgentId: editor.form.voiceAgentId,
    hasElevenLabsKey: editor.hasElevenLabsKey,
  };

  return (
    <Drawer
      open={editor.isOpen}
      onClose={editor.close}
      onBack={editor.canGoBack ? editor.goBack : void 0}
      backButtonTestId="back-button"
      size="lg"
      title={editor.agentId ? "Edit Voice Agent" : "New Voice Agent"}
      body={editor.isEnabled ? "flush" : "padded"}
      bodyScroll={editor.isEnabled ? "content" : "frame"}
      footer={
        editor.isEnabled
          ? {
              cancel: { onClick: editor.close },
              secondaryAction: {
                label: "Talk to it",
                onClick: editor.openTalk,
                disabledReason: talkTooltipFor(prerequisites),
                "data-testid": "voice-agent-talk",
              },
              primaryAction: {
                label: editor.savedAgentId ? "Save Changes" : "Create Agent",
                onClick: editor.save,
                loading: editor.isSaving,
                "data-testid": "save-agent-button",
              },
            }
          : void 0
      }
    >
      {editor.isEnabled ? (
        <VoiceAgentBody editor={editor} />
      ) : (
        <Text data-testid="voice-agents-disabled-message">
          Voice agents are not enabled for this project.
        </Text>
      )}
    </Drawer>
  );
}
