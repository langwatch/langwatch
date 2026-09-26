import { Button, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/studio-dialog";
import { ArrowLeft } from "lucide-react";

import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { WiredTalkToItPanel } from "../../../../features/talk-to-it/ui/sections/wired-talk-to-it-panel.tsx";
import type { VoiceCallTarget } from "./voice-call-target.ts";

/** The "Call it myself" body, shown in place of the fields; it owns the project lookup. */
export function RunDialogCallBody({
  voiceCall,
  onBack,
}: {
  voiceCall: VoiceCallTarget;
  onBack: () => void;
}) {
  const { project } = useOrganizationTeamProject();
  return (
    <Dialog.Body paddingX={5} paddingY={4} maxHeight="58vh" overflowY="auto">
      <VStack align="stretch" gap={3} data-testid="run-dialog-call">
        <Button
          variant="ghost"
          size="sm"
          alignSelf="flex-start"
          onClick={onBack}
          data-testid="run-dialog-call-back"
        >
          <ArrowLeft size={16} /> Back
        </Button>
        <WiredTalkToItPanel
          projectId={project?.id ?? ""}
          projectSlug={project?.slug ?? ""}
          transport={voiceCall.transport}
          agentId={voiceCall.agentId}
          agentRowId={voiceCall.agentRowId}
          scenarioId={voiceCall.scenarioId}
        />
      </VStack>
    </Dialog.Body>
  );
}
