import { nanoid } from "nanoid";

export function createDraftHandle() {
  return `prompt-${nanoid(5)}`.toLowerCase();
}
