/**
 * What the three prompt dialogs are asked to do, and what they answer with.
 *
 * `platform/app` declared these three parameter objects against
 * `RouterInputs["prompts"]["create"]["data"]` and
 * `RouterInputs["prompts"]["update"]["data"]` — an inference through the whole
 * application router, which is exactly what a browser package may not name.
 * They are declared against `@langwatch/prompt-contract`'s
 * `PromptCreateTrpcInput` / `PromptUpdateTrpcInput` instead, and that is a REAL
 * repoint rather than a restatement: the producer is packaged
 * (`@langwatch/prompt-server` builds the same two schemas from the same
 * factories), so both halves of the wire now resolve to one declaration.
 */

import type {
  PromptCreateTrpcInput,
  PromptUpdateTrpcInput,
  VersionedPrompt,
} from "@langwatch/prompt-contract";

/** Parameters for creating a new prompt configuration. */
export type CreatePromptParams = {
  data: Omit<PromptCreateTrpcInput["data"], "handle">;
  onSuccess?: (prompt: VersionedPrompt) => void;
  onError?: (error: Error) => void;
};

/**
 * Parameters for changing an existing prompt's handle.
 *
 * Only the id is needed to open the dialog; the provider looks the prompt up.
 */
export type ChangeHandleParams = {
  id: string;
  onSuccess?: (prompt: VersionedPrompt) => void;
  onError?: (error: Error) => void;
};

/** Parameters for saving a version of a prompt configuration. */
export type SaveVersionParams = {
  id: PromptUpdateTrpcInput["id"];
  data: Omit<PromptUpdateTrpcInput["data"], "commitMessage">;
  /** Next version number to display in the dialog (e.g. "Update to v5"). */
  nextVersion?: number;
  onSuccess?: (prompt: VersionedPrompt) => void;
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
