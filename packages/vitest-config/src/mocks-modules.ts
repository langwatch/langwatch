// The calls that rewrite a file's module registry. `vi.hoisted` counts: it only
// exists to feed a hoisted `vi.mock`. The one definition, for the isolation split
// here and the integration lanes in @langwatch/test-harness.
const MOCKS_MODULES = /\bvi\s*\.\s*(?:mock|doMock|unmock|doUnmock|resetModules|hoisted)\s*\(/;

export function mocksModules(source: string): boolean {
  return MOCKS_MODULES.test(source);
}
