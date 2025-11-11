export function createTabId() {
  return `tab-${crypto.randomUUID()}`;
}

export function createWindowId() {
  return `window-${crypto.randomUUID()}`;
}
