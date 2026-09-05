/**
 * Builds an anchored regex that matches exactly one model name string, for
 * auto-generating model cost rule patterns from a span's recorded model.
 */
export function exactModelMatchRegex(model: string): string {
  return `^${model.replace(/[/\\^$.*+?()[\]{}|]/g, "\\$&")}$`;
}
