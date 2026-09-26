import { Button, VStack } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

import { TalkToItPanel } from "../../behavior/lent-talk-to-it-panel.tsx";
import type { VoiceAgentEditor } from "../../behavior/use-voice-agent-editor.ts";

/** The call panel scenario lends, handed the draft as it stands (no save first). */
export function VoiceAgentTalkView({ editor }: { editor: VoiceAgentEditor }) {
  const { form } = editor;
  return (
    <VStack gap={4} align="stretch" flex={1} overflowY="auto" paddingX={6} paddingY={4}>
      <Button
        variant="ghost"
        size="sm"
        alignSelf="flex-start"
        onClick={editor.closeTalk}
        data-testid="voice-agent-talk-back"
      >
        <ArrowLeft size={16} /> Back
      </Button>
      <TalkToItPanel
        projectId={editor.projectId}
        projectSlug={editor.project?.slug ?? ""}
        transport={form.transport}
        agentId={form.voiceAgentId.trim()}
        agentRowId={editor.savedAgentId}
        name={form.name.trim() || void 0}
        onAgentCreated={editor.agentCreated}
      />
    </VStack>
  );
}
