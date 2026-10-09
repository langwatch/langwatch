/**
 * The port the inbox screen and everything insight lends read: scope, the release flag,
 * grants, the address, notices, the clipboard and Langy's ask. Mounted above the routed tree,
 * so the bell in the topbar and the action under a Langy answer find it too.
 */

import type { LangyAskRequest } from "@langwatch/langy-contract";
import { createContext, useContext } from "react";

export type InsightHostProject = { id: string; slug: string };

export type InsightSuccessNotice = { title: string; description?: string };

/** Raw errors travel so the host resolves the words from the error's code. */
export type InsightFailureNotice = { error: unknown; fallbackTitle: string };

export abstract class InsightHostApi {
  /** The project in scope, or undefined outside one or before it resolves. */
  abstract project(): InsightHostProject | undefined;

  /** `release_insights`: undefined while not answered yet. */
  abstract isEnabled(): boolean | undefined;

  abstract hasPermission(permission: string): boolean;

  abstract query(): Readonly<Record<string, string | undefined>>;

  abstract setQuery(next: Readonly<Record<string, string | undefined>>): void;

  abstract navigate(to: string): void;

  abstract succeeded(notice: InsightSuccessNotice): void;

  abstract failed(failure: InsightFailureNotice): void;

  /** Writes plain text to the clipboard; false where the browser refuses or has none. */
  abstract copyToClipboard(text: string): Promise<boolean>;

  /** Opens Langy with a question or a draft; does nothing where Langy is not installed. */
  abstract askLangy(request: LangyAskRequest): void;
}

const InsightHostContext = createContext<InsightHostApi | undefined>(void 0);

export const InsightHostProvider = InsightHostContext.Provider;

export function useInsightHost(): InsightHostApi {
  const host = useContext(InsightHostContext);
  if (!host) {
    throw new Error(
      "No insight host is mounted above this component; render it inside the insight browser module.",
    );
  }
  return host;
}
