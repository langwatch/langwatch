import { nanoid } from "nanoid";

export function createDraftHandle() {
  return `drafts/prompt-${nanoid(5)}`;
}
