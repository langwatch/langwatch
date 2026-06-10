/**
 * Builds an anchored regex that matches exactly one model name string, for
 * auto-generating model cost rule patterns from a span's recorded model.
 *
 * Escapes every regex metacharacter, including the forward slash, `/` is
 * valid unescaped in a pattern compiled via `new RegExp(string)`, but the
 * model-cost UI renders patterns between `/.../` delimiters, so emitting
 * `\/` keeps the displayed literal unambiguous.
 */
export function exactModelMatchRegex(model: string): string {
  return `^${model.replace(/[/\\^$.*+?()[\]{}|]/g, "\\$&")}$`;
}
