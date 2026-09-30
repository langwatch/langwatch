import { mkdirSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Finding, Navigation, RunComplete } from "./protocol.ts";

/** SHOTS_PER_SIGNATURE bounds screenshots: ten thousand hits of one cause need three pictures. */
export const SHOTS_PER_SIGNATURE = 3;

/**
 * FindingSink is where findings go: one line each in the run's findings.jsonl, and the
 * counts of oracles and signatures the run-complete line reports.
 */
export class FindingSink {
  private readonly signatures = new Map<string, number>();
  private readonly oracles: Record<string, number> = {};
  private total = 0;
  private shots = 0;
  private readonly writes = new Set<Promise<void>>();

  /** runDir holds findings.jsonl; screenshots go in its ui directory, named relative to runDir. */
  constructor(private readonly runDir: string) {
    mkdirSync(join(runDir, "ui"), { recursive: true });
  }

  /** wantsScreenshot is false once a signature has its pictures. */
  wantsScreenshot(signature: string): boolean {
    return (this.signatures.get(signature) ?? 0) < SHOTS_PER_SIGNATURE;
  }

  /** nextShot names the next screenshot: its file, and its path relative to the run directory. */
  nextShot(navigation: Navigation): { file: string; relative: string } {
    const name = `${String(++this.shots).padStart(4, "0")}-${navigation}.png`;
    return { file: join(this.runDir, "ui", name), relative: `ui/${name}` };
  }

  /** save writes a screenshot in the background: the monkey moves on before the disk answers. */
  save({ file, bytes }: { file: string; bytes: Buffer }): void {
    this.background(writeFile(file, bytes));
  }

  /** flush waits for every background write; call it once, when the walk is over. */
  async flush(): Promise<void> {
    await Promise.all(this.writes);
  }

  write(finding: Finding): void {
    this.signatures.set(finding.signature, (this.signatures.get(finding.signature) ?? 0) + 1);
    this.oracles[finding.oracle] = (this.oracles[finding.oracle] ?? 0) + 1;
    this.total += 1;
    this.emit(finding);
  }

  complete({
    routesExercised,
    routesTotal,
  }: Pick<RunComplete, "routesExercised" | "routesTotal">): void {
    this.emit({
      kind: "run-complete",
      total: this.total,
      counts: this.oracles,
      routesExercised,
      routesTotal,
      capturedAt: new Date().toISOString(),
    });
  }

  get findings(): number {
    return this.total;
  }

  get distinct(): number {
    return this.signatures.size;
  }

  private emit(line: Finding | RunComplete): void {
    const text = `${JSON.stringify(line)}\n`;
    this.background(appendFile(join(this.runDir, "findings.jsonl"), text));
  }

  private background(write: Promise<void>): void {
    const tracked = write.catch(() => undefined).finally(() => this.writes.delete(tracked));
    this.writes.add(tracked);
  }
}

/** VisitSink is what a visit writes findings and screenshots through. */
export type VisitSink = Pick<FindingSink, "wantsScreenshot" | "nextShot" | "save" | "write">;

/** HeldFindings keeps one visit's findings back until the lane knows the page did not crash. */
export class HeldFindings implements VisitSink {
  private readonly held: Finding[] = [];

  constructor(private readonly sink: FindingSink) {}

  wantsScreenshot(signature: string): boolean {
    return this.sink.wantsScreenshot(signature);
  }

  nextShot(navigation: Navigation): { file: string; relative: string } {
    return this.sink.nextShot(navigation);
  }

  save(shot: { file: string; bytes: Buffer }): void {
    this.sink.save(shot);
  }

  write(finding: Finding): void {
    this.held.push(finding);
  }

  release(): void {
    for (const finding of this.held) this.sink.write(finding);
  }
}
