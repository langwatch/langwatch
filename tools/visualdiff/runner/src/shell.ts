import type { CaptureMessage } from "./protocol.ts";

/** SHELL_PROBE is how many of the candidate's first routes decide whether its shell renders. */
export const SHELL_PROBE = 3;

export interface ShellProbe {
  capture: CaptureMessage;
  blank: boolean;
}

const brokenReason = ({ capture, blank }: ShellProbe): string => {
  if (capture.error !== "") return capture.error;
  const pageError = capture.consoleErrors.find((text) => text.startsWith("pageerror:"));
  if (pageError !== undefined) return pageError;
  return blank ? "rendered a blank page" : "";
};

/**
 * shellBroken names why the candidate's shell is broken once every one of the
 * first SHELL_PROBE routes failed to render, and returns "" otherwise, so a
 * run aborts in seconds instead of photographing a broken shell on every route.
 */
export const shellBroken = ({ probes }: { probes: ShellProbe[] }): string => {
  if (probes.length < SHELL_PROBE) return "";
  const reasons = probes.slice(0, SHELL_PROBE).map(brokenReason);
  if (reasons.some((reason) => reason === "")) return "";
  return probes
    .slice(0, SHELL_PROBE)
    .map((probe, index) => `${probe.capture.key}: ${reasons[index]}`)
    .join("; ");
};
