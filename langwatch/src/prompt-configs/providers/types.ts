import { type RouterInputs } from "~/utils/api";
import { type VersionedPrompt } from "~/server/prompt-config";

/**
 * Base parameters for prompt operation callbacks
 */
interface PromptOperationCallbacks {
  onError?: (error: Error) => void;
  onSuccess?: (prompt: VersionedPrompt) => void;
}

/**
 * Parameters for creating a new prompt configuration
 */
export type CreatePromptParams = Omit<RouterInputs["prompts"]["create"], "projectId"> & PromptOperationCallbacks;

/**
 * Parameters for updating an existing prompt configuration
 */
export type UpdatePromptParams = Omit<RouterInputs["prompts"]["update"], "projectId"> & PromptOperationCallbacks;

/**
 * Context interface for prompt configuration operations
 */
export interface PromptConfigContextType {
  /** Creates a new prompt configuration with version */
  triggerSaveVersion: (params: CreatePromptParams) => Promise<VersionedPrompt>;
  /** Updates an existing prompt's handle and metadata */
  triggerChangeHandle: (params: UpdatePromptParams) => Promise<VersionedPrompt>;
}