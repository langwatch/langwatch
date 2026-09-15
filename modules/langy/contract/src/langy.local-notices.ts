/**
 * Lines the platform writes about the developer's folder (ADR-129), as
 * USER messages. Shared so server and panel never drift on the string.
 */

/** The message the connected folder starts the next turn with. */
export const LANGY_LOCAL_CONNECT_NOTICE = "Local folder connected";

/** Whether one transcript message is a platform notice the panel hides. */
export function isLangyHiddenLocalNotice(message: {
  role?: string;
  parts?: readonly unknown[];
}): boolean {
  if (message.role !== "user") return false;
  const parts = message.parts ?? [];
  if (parts.length === 0) return false;
  let text = "";
  for (const part of parts) {
    const typed = part as { type?: string; text?: string };
    if (typed?.type !== "text") return false;
    text += typed.text ?? "";
  }
  return text.trim() === LANGY_LOCAL_CONNECT_NOTICE;
}
