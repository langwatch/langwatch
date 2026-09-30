import { createContext, useContext } from "react";

/**
 * Whether LangWatch uses this install's Langy chats to improve Langy, which
 * decides if the composer says so. True on LangWatch Cloud only: a self-hosted
 * install sends none of its chats to LangWatch
 * (docs/self-hosting/data-and-telemetry.mdx). False where no provider is
 * mounted, so a composer never claims it by default.
 */
export const LangyChatsImproveLangyContext = createContext(false);

/** Reads whether the composer should say chats help improve Langy. */
export function useLangyChatsImproveLangy(): boolean {
  return useContext(LangyChatsImproveLangyContext);
}
