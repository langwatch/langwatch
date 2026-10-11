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
});
