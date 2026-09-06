/**
 * The lines the platform itself writes into a Langy conversation about the
 * developer's own folder (ADR-129).
 *
 * They are written as USER messages, because they are what starts the next
 * turn and what the model reads. They are not what the developer said, and the
 * panel does not draw the connect one as a bubble: the header chip and the code
 * access card already carry it, so a bubble made the same fact appear three
 * times in a row.
 *
 * Shared, because the server writes them and the panel reads them, and two
 * copies of a string like this drift into a notice nobody hides.
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
