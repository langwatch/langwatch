/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-command.feature
 * @see modules/ops/specs/ops-system-migrations.feature
 */
import { describe, expect, it } from "vitest";

import { upgradeOutcome } from "../../runner/upgrade-outcome.ts";
import {
  inProcessUpgrade,
  langWatchQlReconciler,
  passRequestReconciler,
} from "../in-process-upgrade.ts";

const signal = new AbortController().signal;

describe("langWatchQlReconciler()", () => {
  /** @scenario "The worker's upgrade provisions LangWatchQL through the tasks app under its own lease" */
  it("succeeds on exit 0 and fails the reconciler on any other exit", async () => {
    const ok = langWatchQlReconciler({ environment: {}, command: "true", args: [] });
    const refused = langWatchQlReconciler({ environment: {}, command: "false", args: [] });

    expect(ok.name).toBe("langwatchql");
    await expect(ok.run({ signal })).resolves.toBeUndefined();
    await expect(refused.run({ signal })).rejects.toThrow("exited with code 1");
  });
});

describe("passRequestReconciler()", () => {
  /** @scenario "The pass a finished upgrade requests runs ahead of any queue backlog" */
  it("runs ops' pass request inside the queue's listed work", async () => {
    const ran: string[] = [];
    const reconciler = passRequestReconciler({
      modules: {
        tasks: <Task>(isTask: (contribution: unknown) => contribution is Task) =>
          [
            { name: "other", run: async () => void ran.push("other") },
            { name: "request-system-migrations-pass", run: async () => void ran.push("pass") },
          ].flatMap((each) => (isTask(each) ? [each] : [])),
        runListedWork: async ({ name, work }) => {
          ran.push(`listed ${name}`);
          return work();
        },
      },
    });

    await reconciler.run({ signal });

    expect(ran).toEqual(["listed task:request-system-migrations-pass", "pass"]);
  });

  it("warns and lets the run go on when the request does not settle", async () => {
    const reconciler = passRequestReconciler({
      modules: {
        tasks: <Task>(isTask: (contribution: unknown) => contribution is Task) =>
          [{ name: "request-system-migrations-pass", run: async () => undefined }].flatMap(
            (each) => (isTask(each) ? [each] : []),
          ),
        runListedWork: async () => {
          throw new Error("Queue work had not all run within 60000 ms");
        },
      },
    });

    await expect(reconciler.run({ signal })).resolves.toBeUndefined();
  });
});

describe("inProcessUpgrade()", () => {
  const modules = {
    migrationSteps: () => [],
    upcastReader: () => undefined,
    tasks: () => [],
    runListedWork: <Result>({ work }: { work: () => Promise<Result> }) => work(),
  };

  /** @scenario "A worker's in-process run publishes its read hints on the worker's Redis" */
  it("hands the run the worker's Redis publisher and closes it once the run ends", async () => {
    const published: string[] = [];
    let closed = 0;
    const upgrade = inProcessUpgrade({
      boot: (use) => use(modules),
      databaseUrl: "postgresql://localhost:1/never",
      environment: {},
      development: false,
      admitAtBlockingDone: false,
      openPublisher: () => ({
        publish: async (channel, message) => void published.push(`${channel} ${message}`),
        close: async () => void (closed += 1),
      }),
      run: async ({ inputs }) => {
        await inputs.publish?.("eventing:read_invalidated", "hint");
        return upgradeOutcome({ code: "done", message: "upgraded" });
      },
    });

    expect(await upgrade()).toEqual({ code: "done", logTail: ["upgraded"] });
    expect(published).toEqual(["eventing:read_invalidated hint"]);
    expect(closed).toBe(1);
  });

  /** @scenario "A serving worker takes jobs once the blocking part is done, before the reconcilers end" */
  it("answers done at the blocking part's end while the reconcilers still run", async () => {
    let finishReconcilers = () => {};
    const reconcilersEnd = new Promise<void>((resolve) => {
      finishReconcilers = resolve;
    });
    let ended = false;
    const upgrade = inProcessUpgrade({
      boot: (use) => use(modules),
      databaseUrl: "postgresql://localhost:1/never",
      environment: {},
      development: false,
      admitAtBlockingDone: true,
      run: async ({ inputs }) => {
        inputs.onBlockingDone?.();
        await reconcilersEnd;
        ended = true;
        return upgradeOutcome({ code: "done", message: "upgraded" });
      },
    });

    const answer = await upgrade();

    expect(answer.code).toBe("done");
    expect(answer.logTail[0]).toMatch(/the reconcilers finish beside the worker/);
    expect(ended).toBe(false);
    finishReconcilers();
  });

  it("answers the run's own failure when it fails before the blocking part is done", async () => {
    const upgrade = inProcessUpgrade({
      boot: (use) => use(modules),
      databaseUrl: "postgresql://localhost:1/never",
      environment: {},
      development: false,
      admitAtBlockingDone: true,
      run: async () => upgradeOutcome({ code: "failed", message: "schema refused" }),
    });

    expect(await upgrade()).toEqual({ code: "failed", logTail: ["schema refused"] });
  });

  /** @scenario "`pnpm task upgrade` waits for the reconcilers and answers the whole run's outcome" */
  it("waits for the whole run on the run-once path, a failed reconciler failing it", async () => {
    const upgrade = inProcessUpgrade({
      boot: (use) => use(modules),
      databaseUrl: "postgresql://localhost:1/never",
      environment: {},
      development: false,
      admitAtBlockingDone: false,
      run: async ({ inputs }) => {
        inputs.onBlockingDone?.();
        return upgradeOutcome({ code: "failed", message: "reconciler langwatchql failed" });
      },
    });

    expect(await upgrade()).toEqual({ code: "failed", logTail: ["reconciler langwatchql failed"] });
  });

  /** @scenario "A run-once upgrade leaves the system-migrations pass request to the serving worker" */
  it("hands the pass request only to a serving worker's run", async () => {
    const reconcilerNames = async ({ admitAtBlockingDone }: { admitAtBlockingDone: boolean }) => {
      let names: string[] = [];
      await inProcessUpgrade({
        boot: (use) => use(modules),
        databaseUrl: "postgresql://localhost:1/never",
        environment: {},
        development: false,
        admitAtBlockingDone,
        run: async ({ inputs }) => {
          names = (inputs.reconcilers ?? []).map((reconciler) => reconciler.name);
          return upgradeOutcome({ code: "done", message: "upgraded" });
        },
      })();
      return names;
    };

    expect(await reconcilerNames({ admitAtBlockingDone: false })).not.toContain(
      "system-migrations-pass-request",
    );
    expect(await reconcilerNames({ admitAtBlockingDone: true })).toContain(
      "system-migrations-pass-request",
    );
  });
});
