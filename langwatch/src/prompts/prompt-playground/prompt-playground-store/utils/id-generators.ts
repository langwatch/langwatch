import { nanoid } from "nanoid";

export function createTabId() {
  return `tab-${nanoid()}`;
}

export function createWindowId() {
  return `window-${nanoid()}`;
}
