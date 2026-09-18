import type { ApplyPatchOperation } from './types/protocol';
export type { ApplyPatchOperation } from './types/protocol';
/**
 * Result returned by an Editor operation.
 */
export type ApplyPatchResult = {
    /**
     * Whether the operation completed successfully. Defaults to `completed`.
     */
    status?: 'completed' | 'failed';
    /**
     * Optional textual output to forward to the model.
     */
    output?: string;
};
/**
 * Host interface responsible for applying diffs on disk.
 */
export interface Editor {
    /**
     * Creates a new file from a V4A diff.
     */
    createFile(operation: Extract<ApplyPatchOperation, {
        type: 'create_file';
    }>): Promise<ApplyPatchResult | void>;
    /**
     * Updates an existing file based on a V4A diff.
     */
    updateFile(operation: Extract<ApplyPatchOperation, {
        type: 'update_file';
    }>): Promise<ApplyPatchResult | void>;
    /**
     * Deletes an existing file.
     */
    deleteFile(operation: Extract<ApplyPatchOperation, {
        type: 'delete_file';
    }>): Promise<ApplyPatchResult | void>;
}
