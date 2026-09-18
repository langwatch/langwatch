/**
 * Applies a headerless V4A diff to the provided file content.
 * - mode "default": patch an existing file using V4A sections ("@@" + +/-/space lines).
 * - mode "create": create-file syntax that requires every line to start with "+".
 *
 * The function preserves trailing newlines from the original file and throws when
 * the diff cannot be applied cleanly.
 */
export declare function applyDiff(input: string, diff: string, mode?: 'default' | 'create'): string;
