import type { ServerComponent } from "./server.ts";

type Runtime = Readonly<{ start(): Promise<void> | void; stop(): Promise<void> | void }>;

/**
 * The booted application, spoken as a component: the chain stays fluent and
 * no call site hand-rolls a `{ name, start, stop }` object.
 */
export function hostedRuntime({
  name,
  runtime,
  drain,
}: Readonly<{ name: string; runtime: Runtime; drain?: boolean }>): ServerComponent {
  return {
    name,
    start: () => runtime.start(),
    stop: () => runtime.stop(),
    ...(drain === true ? { drain: true } : {}),
  };
}
