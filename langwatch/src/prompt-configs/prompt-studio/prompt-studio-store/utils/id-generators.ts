export function createTabId() {
  return `tab-${Date.now()}`;
}

export function createWindowId() {
  return `window-${crypto.randomUUID()}`;
}

