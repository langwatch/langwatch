const PAUSE_KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+){0,2}$/;

export function isValidGroupId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 512;
}

export function isValidPauseKey(key: unknown): key is string {
  return typeof key === "string" && key.length > 0 && key.length <= 200 && PAUSE_KEY_PATTERN.test(key);
}
