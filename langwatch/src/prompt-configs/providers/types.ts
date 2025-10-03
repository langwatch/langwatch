import { type RouterInputs } from "~/utils/api";
import { type VersionedPrompt } from "~/server/prompt-config";

/**
 * Parameters for creating a new prompt configuration
 */
export type CreatePromptParams = {
  data: Omit<RouterInputs["prompts"]["create"]["data"], "handle">;
  onSuccess?: (prompt: VersionedPrompt) => void;
  onError?: (error: Error) => void;
};

/**
 * Parameters for updating an existing prompt configuration
 * We only need the id to trigger the dialog, and we look up the prompt by id in the provider
 */
export type ChangeHandleParams = {
  id: string;
  onSuccess?: (prompt: VersionedPrompt) => void;
  onError?: (error: Error) => void;
};

/**
 * Parameters for saving a version of a prompt configuration
 */
export type SaveVersionParams = Omit<
  RouterInputs["prompts"]["update"],
  "projectId"
> & {
  onSuccess?: (prompt: VersionedPrompt) => void;
  onError?: (error: Error) => void;
};

/**
 * Context interface for prompt configuration operations
 */
export interface PromptConfigContextType {
  /** Creates a new prompt configuration with version */
  triggerSaveVersion: (params: SaveVersionParams) => void;
  /** Updates an existing prompt's handle and metadata */
  triggerChangeHandle: (params: ChangeHandleParams) => void;
  /** Creates a new prompt configuration */
  triggerCreatePrompt: (params: CreatePromptParams) => void;
}
