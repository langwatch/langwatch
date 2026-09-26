import { Box, Button, HStack } from "@chakra-ui/react";
import type { VoiceTransport } from "@langwatch/agent-contract";
import { Drawer } from "@langwatch/design-system/drawer";
import { Tooltip } from "@langwatch/design-system/tooltip";

import { canTalkTo, talkTooltipFor } from "../../model/voice-talk.ts";

export function VoiceAgentFooter({
  isSaved,
  transport,
  voiceAgentId,
  hasElevenLabsKey,
  isSaving,
  onCancel,
  onTalk,
  onSave,
}: {
  isSaved: boolean;
  transport: VoiceTransport;
  voiceAgentId: string;
  hasElevenLabsKey: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onTalk: () => void;
  onSave: () => void;
}) {
  const prerequisites = { transport, voiceAgentId, hasElevenLabsKey };
  const talkTooltip = talkTooltipFor(prerequisites);
  return (
    <Drawer.Footer borderTopWidth="1px" borderColor="border">
      <HStack gap={3}>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        {/* No `disabled` on Tooltip: toggling it remounts the Button underneath. */}
        <Tooltip content={talkTooltip ?? ""} positioning={{ placement: "top" }}>
          <Box>
            <Button
              variant="outline"
              disabled={!canTalkTo(prerequisites)}
              title={talkTooltip}
              onClick={onTalk}
              data-testid="voice-agent-talk"
            >
              Talk to it
            </Button>
          </Box>
        </Tooltip>
        <Button
          colorPalette="blue"
          onClick={onSave}
          disabled={isSaving}
          loading={isSaving}
          data-testid="save-agent-button"
        >
          {isSaved ? "Save Changes" : "Create Agent"}
        </Button>
      </HStack>
    </Drawer.Footer>
  );
}
