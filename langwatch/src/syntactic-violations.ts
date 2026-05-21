// Smoke-test for issue #3754 — DO NOT MERGE.
// Expect ast-grep:
//   - `no-explicit-any` on `: any` and `as any`
//   - `no-inline-dynamic-import` on `import("...")`
//   - `no-localhost-fallback` on `?? "http://localhost..."` and the
//     template-literal variant.

export function explicitAnyViolation(input: any): any {
  const cast = input as any;
  return cast;
}

export async function inlineImportViolation(): Promise<unknown> {
  const mod = await import("node:fs");
  return mod;
}

const PORT = "3000";
export const FALLBACK_LITERAL =
  process.env.SERVICE_URL ?? "http://localhost:3000";
export const FALLBACK_TEMPLATE =
  process.env.SERVICE_URL ?? `http://localhost:${PORT}/api`;
