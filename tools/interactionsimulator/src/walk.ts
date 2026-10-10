import { appendFileSync } from "node:fs";
import { join } from "node:path";

import type { Side } from "@langwatch/visual-diff-runner/capture";
import { fillPath } from "@langwatch/visual-diff-runner/flows/context";
import { declinePasskeyOffer } from "@langwatch/visual-diff-runner/flows/primitives";
import type { PlanStep } from "@langwatch/visual-diff-runner/protocol";

import { chooseStep, flagOf, type JevConfig, type StepAnswer } from "./jev.ts";
import type { Ledger } from "./ledger.ts";
import type { JourneyResult } from "./map.ts";
import { actionFor, candidatesOf, pageSummary, perform, type Candidate } from "./page.ts";
import { replan, type Feature, type Journey, type Replan } from "./plan.ts";
import { logSignatures, stackOf } from "./signals.ts";
import type { SonnetConfig } from "./sonnet.ts";

/** Walk is what one page needs to walk journeys: the models, the caps and where evidence goes. */
export interface Walk {
  side: Side;
  slug: string;
  runId: string;
  out: string;
  ledger: Ledger;
  sonnet: SonnetConfig;
  jev: JevConfig;
  maxSteps: number;
  /** capReached names the cap the run has hit, or "". */
  capReached: () => string;
}

export interface Walked {
  result: JourneyResult;
  steps: PlanStep[];
}

interface Proof {
  held: string[];
  missing: string[];
}

interface Choice {
  answer: StepAnswer;
  picked: Candidate | undefined;
  action: "click" | "fill" | "select" | "";
  value: string;
}

const firstLine = (thrown: unknown): string =>
  (thrown instanceof Error ? thrown.message : String(thrown)).split("\n")[0] ?? "";

const describeChoice = ({
  step,
  url,
  choice,
  noticed,
}: {
  step: number;
  url: string;
  choice: Choice;
  noticed: string[];
}): string => {
  const { answer, picked, action, value } = choice;
  const read = `error ${answer.errorShown.toFixed(2)}, progressed ${answer.progressed.toFixed(2)}, stuck ${answer.stuck.toFixed(2)}`;
  const typed = action === "click" ? "" : ` with "${value}"`;
  const chose =
    picked === undefined
      ? answer.element || "nothing"
      : `${action} ${picked.role} "${picked.name}"${typed}`;
  const seen = noticed.length > 0 ? `; noticed: ${noticed.slice(0, 5).join(" | ")}` : "";
  return `${step + 1}. ${url}: ${read}; jev chose ${chose}${seen}`;
};

/**
 * JourneyWalk walks one journey: jev reads each page and picks the next
 * action; Sonnet reads only jev's question and answer log, when jev flags, a
 * step fails or jev says the goal is reached, and decides or re-plans.
 */
export class JourneyWalk {
  private readonly signals: Record<"console" | "network" | "logs", string[]> = {
    console: [],
    network: [],
    logs: [],
  };
  private readonly screens: string[] = [];
  private readonly log: string[] = [];
  private readonly done: PlanStep[] = [];
  private proven: Proof | undefined;
  private since = Date.now();

  constructor(
    private readonly walk: Walk,
    private readonly feature: Feature,
    private journey: Journey,
    private readonly uid: string,
  ) {}

  async run(): Promise<Walked> {
    if (this.journey.blockedBy !== undefined)
      return this.finish({ status: "blocked", reason: this.journey.blockedBy });
    await this.open(this.journey.start);
    this.walk.side.drain();
    for (let step = 0; step < this.walk.maxSteps; step++) {
      const cap = this.walk.capReached();
      if (cap !== "") return this.finish({ status: "untested", reason: cap });
      const why = await this.step(step);
      if (why === "") continue;
      const { sonnet, ledger } = this.walk;
      const walked = await this.decide(
        await replan({
          config: sonnet,
          ledger,
          journey: this.journey,
          steps: this.journey.steps,
          log: this.log,
          why,
        }),
      );
      if (walked !== undefined) return walked;
    }
    return this.finish({
      status: "untested",
      reason: `no verdict within ${this.walk.maxSteps} steps`,
    });
  }

  /** step lets jev read the page and carries out its choice; it answers why Sonnet is needed. */
  private async step(step: number): Promise<string> {
    const choice = await this.observe(step);
    const flag = flagOf({ answer: choice.answer, isFirst: step === 0 });
    if (flag !== "") return `jev flagged that ${flag}`;
    if (choice.answer.element === "done") {
      this.proven = await this.checkProof();
      this.log.push(
        `   proof: held ${JSON.stringify(this.proven.held)}, missing ${JSON.stringify(this.proven.missing)}`,
      );
      return "jev reports the goal reached and the proof was checked";
    }
    if (choice.picked === undefined || choice.action === "") {
      return `jev chose "${choice.answer.element}", which names no element on the page`;
    }
    return this.act({ step, candidate: choice.picked, action: choice.action, value: choice.value });
  }

  private async observe(step: number): Promise<Choice> {
    const { side, jev, ledger } = this.walk;
    this.proven = undefined;
    await declinePasskeyOffer({ page: side.page, probeMillis: 0 });
    const aria = await side.ariaSnapshot();
    const candidates = candidatesOf({ aria });
    const drained = side.drain();
    const logs = await logSignatures({ stack: stackOf(side.baseUrl), since: this.since });
    this.signals.console.push(...drained.consoleErrors);
    this.signals.network.push(...drained.failedRequests);
    this.signals.logs.push(...logs.filter((line) => !this.signals.logs.includes(line)));
    const url = side.relative(side.page.url());
    const { goal, steps, values } = this.journey;
    const answer = await chooseStep({
      config: jev,
      ledger,
      goal,
      steps,
      values,
      history: this.log.slice(-12),
      url,
      page: pageSummary(aria),
      candidates,
    });
    const picked = candidates.find((candidate) => candidate.id === answer.element);
    const choice: Choice = {
      answer,
      picked,
      action: picked === undefined ? "" : actionFor({ role: picked.role, chosen: answer.action }),
      value: values[answer.value] ?? Object.values(values)[0] ?? "",
    };
    const noticed = [...drained.consoleErrors, ...drained.failedRequests, ...logs];
    this.log.push(describeChoice({ step, url, choice, noticed }));
    return choice;
  }

  private async act({
    step,
    candidate,
    action,
    value,
  }: {
    step: number;
    candidate: Candidate;
    action: "click" | "fill" | "select";
    value: string;
  }): Promise<string> {
    const { side } = this.walk;
    let why = "";
    try {
      this.done.push(await perform({ page: side.page, candidate, action, value, uid: this.uid }));
    } catch (thrown) {
      why = `the step failed: ${firstLine(thrown)}`;
      this.log.push(`   ${why}`);
    }
    this.since = Date.now();
    await side.waitUntilQuiet();
    const screen = join(
      this.walk.out,
      "screens",
      this.feature.id,
      this.journey.id,
      `${String(step + 1).padStart(2, "0")}.png`,
    );
    await side.screenshot(screen).then(
      () => this.screens.push(screen),
      () => undefined,
    );
    return why;
  }

  private async decide(decision: Replan): Promise<Walked | undefined> {
    this.log.push(`   Sonnet: ${decision.status}: ${decision.reason}`);
    if (decision.status === "continue") {
      const { steps, values } = decision;
      this.journey = {
        ...this.journey,
        steps: steps ?? this.journey.steps,
        values: { ...this.journey.values, ...values },
      };
      return undefined;
    }
    if (decision.status !== "works")
      return this.finish({ status: decision.status, reason: decision.reason });
    const proof = this.proven ?? (await this.checkProof());
    if (proof.missing.length > 0) {
      return this.finish({
        status: "broken",
        reason: `the proof did not hold: ${proof.missing.join(", ")} missing`,
      });
    }
    return this.finish({ status: "works", reason: decision.reason, held: proof.held });
  }

  private async open(path: string): Promise<void> {
    await this.walk.side.goto(
      fillPath({ path, slug: this.walk.slug, fixtures: { uid: this.uid } }),
    );
    await this.walk.side.waitUntilQuiet();
  }

  /** checkProof reloads the journey's proof page and reads back each text it must show. */
  private async checkProof(): Promise<Proof> {
    await this.open(this.journey.proof.path);
    const proof: Proof = { held: [], missing: [] };
    for (const text of this.journey.proof.texts) {
      const shown = await this.walk.side.page
        .getByText(text.replaceAll("{uid}", this.uid))
        .first()
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(
          () => true,
          () => false,
        );
      (shown ? proof.held : proof.missing).push(text);
    }
    return proof;
  }

  private finish({
    status,
    reason,
    held = [],
  }: {
    status: JourneyResult["status"];
    reason: string;
    held?: string[];
  }): Walked {
    const { signals, screens, journey } = this;
    const failing = [...signals.console, ...signals.network, ...signals.logs];
    if (status === "broken") {
      const finding = {
        feature: this.feature.id,
        journey: journey.id,
        goal: journey.goal,
        reason,
        route: this.walk.side.page.url(),
        action: this.log.at(-1) ?? "",
        screenshot: screens.at(-1) ?? "",
        ...signals,
      };
      appendFileSync(join(this.walk.out, "findings.jsonl"), `${JSON.stringify(finding)}\n`);
    }
    const result = {
      goal: journey.goal,
      status,
      reason,
      run: this.walk.runId,
      evidence: { screens, held, failing },
    };
    return { result, steps: this.done };
  }
}
