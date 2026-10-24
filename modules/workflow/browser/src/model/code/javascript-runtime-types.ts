/**
 * The ambient .d.ts a JavaScript code block is checked against. It declares only what
 * services/nlpgo/app/engine/blocks/codeblock/runner.mjs puts on globalThis (plus
 * QuickJS's own atob, btoa and queueMicrotask), so the editor offers nothing the engine lacks.
 */

export interface JavaScriptField {
  identifier: string;
  type: string;
}

const SECRET_DOC = "/** Project secret, managed in Settings → Secrets. */";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const propertyKey = (name: string) => (IDENTIFIER.test(name) ? name : JSON.stringify(name));

const TS_TYPES: Record<string, string> = {
  str: "string",
  int: "number",
  float: "number",
  bool: "boolean",
  list: "unknown[]",
  "list[str]": "string[]",
  "list[int]": "number[]",
  "list[float]": "number[]",
  "list[bool]": "boolean[]",
  dict: "Record<string, unknown>",
};

/** The TypeScript type a studio field type reaches user code as. */
export function tsTypeFor({ type }: { type: string }): string {
  return TS_TYPES[type] ?? "unknown";
}

function fieldsInterface({ name, fields }: { name: string; fields: readonly JavaScriptField[] }) {
  const members = fields.map((f) => `  ${propertyKey(f.identifier)}: ${tsTypeFor(f)};`);
  return [`interface ${name} {`, ...members, "}"].join("\n");
}

const RUNTIME_GLOBALS = `type HeadersInit = Headers | [string, string][] | Record<string, string>;
declare class Headers implements Iterable<[string, string]> {
  constructor(init?: HeadersInit);
  append(name: string, value: string): void;
  set(name: string, value: string): void;
  get(name: string): string | null;
  has(name: string): boolean;
  delete(name: string): void;
  forEach(callback: (value: string, name: string, headers: Headers) => void): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}
declare class Response {
  private constructor();
  readonly status: number;
  readonly ok: boolean;
  readonly statusText: string;
  readonly url: string;
  readonly headers: Headers;
  text(): Promise<string>;
  json(): Promise<any>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
interface RequestInit {
  method?: string;
  headers?: HeadersInit;
  body?: string | ArrayBuffer | ArrayBufferView | null;
}
/** The engine's HTTP request, held to the deployment's egress policy. */
declare function fetch(input: string | { url: string }, init?: RequestInit): Promise<Response>;
/** Captured into the node's stdout (log, info, debug) and stderr (warn, error). */
declare const console: {
  log(...data: unknown[]): void;
  info(...data: unknown[]): void;
  debug(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
};
interface TimerHandle {
  readonly __timer: unique symbol;
}
declare function setTimeout<A extends unknown[]>(handler: (...args: A) => void, ms?: number, ...args: A): TimerHandle;
declare function setInterval<A extends unknown[]>(handler: (...args: A) => void, ms?: number, ...args: A): TimerHandle;
declare function clearTimeout(handle?: TimerHandle | null): void;
declare function clearInterval(handle?: TimerHandle | null): void;
declare function atob(data: string): string;
declare function btoa(data: string): string;
declare function queueMicrotask(callback: () => void): void;`;

/** Builds the ambient declarations for one open editor from its node's contract. */
export function buildJavaScriptRuntimeDts({
  secretNames,
  inputs,
  outputs,
}: {
  secretNames: readonly string[];
  inputs: readonly JavaScriptField[];
  outputs: readonly JavaScriptField[];
}): string {
  const secrets = secretNames.map(
    (name) => `  ${SECRET_DOC}\n  readonly ${propertyKey(name)}: string;`,
  );
  return [
    "/** Project secrets, managed in Settings → Secrets. Reading an unknown name throws. */",
    ["declare const secrets: {", ...secrets, "};"].join("\n"),
    "/** The run's parameters; each value keeps its JSON type. Reading an unknown name throws. */",
    "declare const params: Readonly<Record<string, unknown>>;",
    "/** The node's inputs, as the one object the entrypoint receives. */",
    fieldsInterface({ name: "Inputs", fields: inputs }),
    "/** The node's outputs, as the object the entrypoint returns. */",
    fieldsInterface({ name: "Outputs", fields: outputs }),
    RUNTIME_GLOBALS,
    "",
  ].join("\n");
}
