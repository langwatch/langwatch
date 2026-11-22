import { VOICE_TRANSPORTS } from "@langwatch/scenario-contract";

import { useVoiceSessionClient } from "../../behavior/use-voice-session-client.ts";
import type { TalkToItPanelProps } from "../../model/talk-to-it-props.ts";
import { TalkToItPanel } from "./talk-to-it-panel.tsx";

export type WiredTalkToItPanelProps = Omit<TalkToItPanelProps, "sessionClient">;

/** The call panel over scenario's own voice-session procedures. */
export function WiredTalkToItPanel(props: WiredTalkToItPanelProps) {
  const sessionClient = useVoiceSessionClient();
  return <TalkToItPanel {...props} sessionClient={sessionClient} />;
}

/** What a peer's editor hands the lent panel: the transport arrives as the key it stored. */
export type LentTalkToItPanelProps = Omit<WiredTalkToItPanelProps, "transport" | "scenarioId"> & {
  transport: string;
};

/** The panel as scenario lends it (§3.4 rule 7); an unknown transport has no call to offer. */
export function LentTalkToItPanel({ transport, ...props }: LentTalkToItPanelProps) {
  const known = VOICE_TRANSPORTS.find((candidate) => candidate === transport);
  if (!known) return null;
  return <WiredTalkToItPanel {...props} transport={known} />;
}
