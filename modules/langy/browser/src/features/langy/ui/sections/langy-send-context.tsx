import { createContext, type ReactNode, useContext } from "react";

/**
 * The composer's send, handed to a conversation's cards so a card can offer a next step in words:
 * the message goes to Langy as if typed, and Langy asks what it must (which target, which
 * parameters) instead of the card scheduling anything itself.
 */
export interface LangySend {
  /** Sends a message through the composer, as if the reader had typed it. */
  send: (text: string) => void;
  /** True while Langy is answering; an offer that sends waits it out. */
  isTurnInFlight: boolean;
}

const LangySendContext = createContext<LangySend | null>(null);

export function LangySendProvider({
  value,
  children,
}: {
  value: LangySend | null;
  children: ReactNode;
}) {
  return <LangySendContext.Provider value={value}>{children}</LangySendContext.Provider>;
}

/**
 * The panel's send, or null when the card can route no request: a replayed
 * conversation, or a card rendered outside the panel.
 */
export function useLangySend(): LangySend | null {
  return useContext(LangySendContext);
}
