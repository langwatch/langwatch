import type { CaptureMessage } from "./protocol";

/**
 * Report failures on only one side; failures on both indicate fixture or locator problems,
 * not a difference between refs.
 */
export interface OneSidedFailure {
  key: string;
  index: number;
  label: string;
  failedOn: string;
  error: string;
}

export const oneSidedFailures = ({
  captures,
}: {
  captures: CaptureMessage[];
}): OneSidedFailure[] => {
  const bySide = new Map<string, CaptureMessage[]>();
  for (const capture of captures) {
    if (capture.kind !== "flow") continue;
    const identity = `${capture.key}#${capture.index}`;
    const existing = bySide.get(identity);
    if (existing) existing.push(capture);
    else bySide.set(identity, [capture]);
  }

  const failures: OneSidedFailure[] = [];
  for (const group of bySide.values()) {
    const failed = group.filter((capture) => capture.error !== "");
    if (failed.length === 0 || failed.length === group.length) continue;
    for (const capture of failed) {
      failures.push({
        key: capture.key,
        index: capture.index,
        label: capture.label,
        failedOn: capture.side,
        error: capture.error,
      });
    }
  }
  return failures;
};
