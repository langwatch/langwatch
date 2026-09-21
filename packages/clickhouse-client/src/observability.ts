/**
 * Observability must not change what it observes.
 *
 * Every reporting hook this package calls — a span, a counter, a log line, an
 * audit callback — is host code running on the caller's thread, and most of
 * them run inside a `catch`. An exception from one of them would propagate in
 * place of the failure being reported, so the caller would be handed a
 * telemetry error and never learn what actually went wrong. Anything whose
 * only job is to describe the work goes through here.
 */
export function quietly(report: () => void): void {
  try {
    report();
  } catch {
    // Deliberately swallowed. The only channel for reporting a broken
    // reporting hook is the hook that just threw.
  }
}
