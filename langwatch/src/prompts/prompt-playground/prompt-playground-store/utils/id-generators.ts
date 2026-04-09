import { generateUUID } from "~/utils/generateUUID";

export function createTabId() {
  return `tab-${generateUUID()}`;
}

export function createWindowId() {
  return `window-${generateUUID()}`;
}
