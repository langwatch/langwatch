// Ambient platform globals for package compilation.
// Ambient .d.ts is part of the program but never emitted to dist/.

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
