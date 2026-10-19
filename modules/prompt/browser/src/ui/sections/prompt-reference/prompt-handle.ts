export const NEW_PROMPT_TITLE = "New Prompt";

export function getDisplayHandle(handle?: string | null): string {
  if (!handle) return NEW_PROMPT_TITLE;
  return handle.split("/").at(-1) || handle;
}

export function getPromptFolder(handle?: string | null): string | undefined {
  if (!handle?.includes("/")) return undefined;
  return handle.split("/")[0] || undefined;
}
