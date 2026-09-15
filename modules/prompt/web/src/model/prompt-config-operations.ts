import type { WireVersionedPrompt } from "./wire-versioned-prompt.ts";
/**
 * What the three prompt dialogs are asked to do, and what they answer with.
 * Declared against `@langwatch/prompt-contract`'s `PromptCreateTrpcInput`/
 * `PromptUpdateTrpcInput` rather than a router inference a browser package
 * may not name — a real repoint, since the server builds the same schemas.
 */

import type { PromptCreateTrpcInput, PromptUpdateTrpcInput } from "@langwatch/prompt-contract";

/** Parameters for creating a new prompt configuration. */
export type CreatePromptParams = {
  data: Omit<PromptCreateTrpcInput["data"], "handle">;
  onSuccess?: (prompt: WireVersionedPrompt) => void;
  onError?: (error: Error) => void;
};

/**
 * Parameters for changing an existing prompt's handle.
 *
 * Only the id is needed to open the dialog; the provider looks the prompt up.
 */
export type ChangeHandleParams = {
  id: string;
  onSuccess?: (prompt: WireVersionedPrompt) => void;
  onError?: (error: Error) => void;
};

/** Parameters for saving a version of a prompt configuration. */
export type SaveVersionParams = {
  id: PromptUpdateTrpcInput["id"];
  data: Omit<PromptUpdateTrpcInput["data"], "commitMessage">;
  /** Next version number to display in the dialog (e.g. "Update to v5"). */
  nextVersion?: number;
  onSuccess?: (prompt: WireVersionedPrompt) => void;
  onError?: (error: Error) => void;
};

/** The prompt-configuration operations the screen's provider offers. */
export interface PromptConfigContextType {
  /** Saves a new version of an existing prompt. */
  triggerSaveVersion: (params: SaveVersionParams) => void;
  /** Updates an existing prompt's handle and scope. */
  triggerChangeHandle: (params: ChangeHandleParams) => void;
  /** Creates a new prompt configuration. */
  triggerCreatePrompt: (params: CreatePromptParams) => void;
}
