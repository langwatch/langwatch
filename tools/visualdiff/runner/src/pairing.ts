import { readFileSync } from "node:fs";
import { join } from "node:path";

import { withoutScheme } from "./color-scheme.ts";
import type { DiffFiles, PixelDiff } from "./diff.ts";
import type { CaptureMessage, DiffMessage, Plan } from "./protocol.ts";

/** SIGN_IN_FLOW is the flow key of the one capture sign-in takes: the passkey offer. */
export const SIGN_IN_FLOW = "sign-in";

export const safeName = (value: string): string =>
  value === "/" ? "_root" : value.replace(/^\//, "").replace(/[/?=&{}]/g, "_");

const identity = (capture: CaptureMessage): string =>
  `${capture.kind}|${capture.key}|${capture.index}`;

type Differ = (files: DiffFiles) => Promise<PixelDiff | null>;

/**
 * Pairing diffs each screen the moment both sides of it exist, so diffs
 * stream through the run instead of arriving as one burst at its end.
 */
export class Pairing {
  private readonly bySide = new Map<string, Map<string, CaptureMessage>>();

  constructor(
    private readonly plan: Plan,
    private readonly differ: Differ,
  ) {}

  async add(capture: CaptureMessage): Promise<DiffMessage | null> {
    const own = this.bySide.get(capture.side) ?? new Map<string, CaptureMessage>();
    own.set(identity(capture), capture);
    this.bySide.set(capture.side, own);
    const otherSide = capture.side === "base" ? "candidate" : "base";
    const other = this.bySide.get(otherSide)?.get(identity(capture));
    if (other === undefined) return null;
    const [base, candidate] = capture.side === "base" ? [capture, other] : [other, capture];
    const file = join(
      this.plan.outDir,
      "diff",
      `${safeName(candidate.kind)}_${safeName(candidate.key)}_${candidate.index}.png`,
    );
    const diff = await this.differ({
      base: base.screenshot,
      candidate: candidate.screenshot,
      out: file,
    });
    if (diff === null) return null;
    return {
      type: "diff",
      kind: candidate.kind,
      key: candidate.key,
      index: candidate.index,
      ratio: diff.ratio,
      file,
    };
  }
}

/**
 * readReplay loads a cached side's captures, narrowed to what this plan asks
 * for, so a baseline recorded for every route answers a recapture of three.
 */
export const readReplay = ({
  file,
  plan,
  side,
}: {
  file: string;
  plan: Plan;
  side: string;
}): CaptureMessage[] => {
  const routes = new Set(plan.routes);
  const flows = new Set([SIGN_IN_FLOW, ...plan.flows.map((flow) => flow.id)]);
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => ({ ...(JSON.parse(line) as CaptureMessage), type: "capture" as const, side }))
    .filter((capture) =>
      capture.kind === "route"
        ? routes.has(withoutScheme(capture.key))
        : flows.has(withoutScheme(capture.key)),
    );
};
