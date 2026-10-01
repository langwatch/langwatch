// Observability must not change what it observes. Reporting hooks run in
// catch blocks; exceptions would propagate instead of reporting the real failure.
export function quietly(report: () => void): void {
  try {
    report();
  } catch {
    // The only channel for reporting a broken reporting hook is the hook that
    // just threw, so the answer to a failed report is no report.
    return;
  }
}
