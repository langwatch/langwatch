// Ambient platform globals for this package's own compilation.
//
// This package is deliberately platform-agnostic: it compiles with an empty
// `types` list and models the host runtimes (browser, Node, Bun, Deno) itself.
// These declarations MUST stay in a non-module .d.ts — an ambient file is part
// of the program but never emitted to dist/, so consumers' global scope stays
// clean. The previous shape (`declare global` inside node.ts/platform.ts)
// leaked `require` and `Buffer` typings into every consumer of the published
// d.ts, which the monorepo carried a pnpm patch to strip.

interface Window {
  crypto: { getRandomValues: (array: Uint8Array) => Uint8Array };
}

interface Process {
  versions: { node?: string; bun?: string };
  pid: number;
}

interface Deno {
  version: string;
}

declare var window: Window | undefined;
declare var process: Process | undefined;
declare var Deno: Deno | undefined;
declare var crypto: { getRandomValues: (array: Uint8Array) => Uint8Array } | undefined;
declare var require: (module: string) => unknown;
declare var Buffer: { from: (input: string, encoding: string) => Uint8Array };
