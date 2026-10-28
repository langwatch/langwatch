import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";

import {
  DEFAULT_WEIGHT_SECONDS,
  balanceByWallTime,
  balanceShards,
  commandFor,
  createSuiteRunner,
  discover,
  exclusionNotices,
  failureAnnotations,
  formatMeasured,
  heaviestFirst,
  isHeavyPackage,
  jobsFor,
  laneOf,
  outcomeOf,
  parseConcurrency,
  parseOnly,
  parseRegister,
  parseShard,
  parseWeights,
  runJobs,
  workerEnvFor,
  scriptsFor,
  shardOf,
  staleEntries,
  summarise,
  wallTimeOf,
  withPackage,
  type DiscoveredPackage,
  type SuiteJob,
  type SuiteOutcome,
} from "./run-package-suites.ts";

const pkg = (name: string, scripts: string[]): DiscoveredPackage => ({
  name,
  dir: `packages/${name.replace(/^@fix\//, "")}`,
  scripts,
});

void describe("given a package's declared scripts", () => {
  void describe("when it declares both test and test:unit", () => {
    void it("runs test:unit and not test, because they are the same suite", () => {
      assert.deepEqual(scriptsFor({ test: "vitest run", "test:unit": "vitest run --unit" }), [
        "test:unit",
      ]);
    });
  });

  void describe("when it declares only test", () => {
    void it("runs test", () => {
      assert.deepEqual(scriptsFor({ test: "vitest run" }), ["test"]);
    });
  });

  void describe("when it declares no suite at all", () => {
    void it("is not discovered, because there is nothing to run", () => {
      assert.deepEqual(scriptsFor({ build: "tsc" }), []);
    });
  });

  void describe("when it declares additional lanes", () => {
    void it("runs every lane, in order, rather than stopping at the first", () => {
      assert.deepEqual(
        scriptsFor({
          test: "vitest run",
          "test:integration": "vitest run -c integration",
          "test:browser": "vitest run -c browser",
        }),
        ["test", "test:integration", "test:browser"],
      );
    });

    /** @scenario "A package whose only suite is an integration suite is still discovered" */
    void it("is discovered when the integration lane is its only suite", () => {
      assert.deepEqual(scriptsFor({ "test:integration": "vitest run -c integration" }), [
        "test:integration",
      ]);
    });

    /** @scenario "A package declaring the browser lane is discovered by CI" */
    void it("is discovered when the browser lane is its only suite", () => {
      assert.deepEqual(scriptsFor({ "test:browser": "vitest run -c browser" }), ["test:browser"]);
    });
  });
});

void describe("given the excluded register", () => {
  void describe("when an entry carries a reason", () => {
    void it("reads the name and the reason", () => {
      const { entries, errors } = parseRegister(
        "@fix/elsewhere  # runs in its own workflow\n",
        "excluded",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(entries, [{ name: "@fix/elsewhere", reason: "runs in its own workflow" }]);
    });
  });

  void describe("when an entry has no reason", () => {
    void it("is an error, because an unexplained entry stops being reviewable", () => {
      const { entries, errors } = parseRegister("@fix/bare\n", "excluded");
      assert.deepEqual(entries, []);
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /is not '<package>  # why it is here'/);
    });
  });

  void describe("when the file has blanks and whole-line comments", () => {
    void it("skips them", () => {
      const { entries, errors } = parseRegister(
        "# a heading\n\n@fix/a  # one\n\n# another note\n@fix/b  # two\n",
        "excluded",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(
        entries.map((e) => e.name),
        ["@fix/a", "@fix/b"],
      );
    });
  });

  void describe("when an entry names a package the workspace no longer has", () => {
    void it("is reported, because a dead entry reads as coverage", () => {
      const stale = staleEntries(
        [
          { name: "@fix/gone", reason: "renamed" },
          { name: "@fix/here", reason: "own workflow" },
        ],
        ["@fix/here"],
      );
      assert.deepEqual(stale, ["@fix/gone"]);
    });
  });
});

void describe("given the workspace listing pnpm returns", () => {
  void describe("when a project is the workspace root", () => {
    void it("is not discovered as a package", () => {
      const found = discover([{ name: "@fix/workspace", path: process.cwd() }], process.cwd());
      assert.deepEqual(found, []);
    });
  });

  void describe("when a project has no manifest on disk", () => {
    void it("is skipped rather than throwing", () => {
      const found = discover(
        [{ name: "@fix/ghost", path: `${process.cwd()}/does-not-exist` }],
        process.cwd(),
      );
      assert.deepEqual(found, []);
    });
  });
});

void describe("given a package the gate runs", () => {
  void describe("when every script passes", () => {
    void it("passes", () => {
      const outcome = outcomeOf(
        pkg("@fix/two-lane", ["test", "test:integration"]),
        new Map(),
        () => 0,
      );
      assert.equal(outcome.outcome, "passed");
    });
  });

  void describe("when a later lane fails", () => {
    /** @scenario "A failing integration suite fails the package and names the script" */
    void it("fails the package and names the lane that failed, not the first one", () => {
      const outcome = outcomeOf(
        pkg("@fix/two-lane", ["test", "test:integration"]),
        new Map(),
        (script) => (script === "test:integration" ? 1 : 0),
      );
      assert.equal(outcome.outcome, "failed");
      assert.equal(outcome.failedScript, "test:integration");
    });

    /** @scenario "A package that declares an integration suite has it run" */
    void it("still runs the remaining lanes, so one push shows every failure", async () => {
      const two = pkg("@fix/two-lane", ["test", "test:integration"]);
      const ran: string[] = [];
      await runJobs({
        jobs: jobsFor([two], new Map()),
        concurrency: 1,
        run: async (job) => {
          ran.push(job.script);
          return job.script === "test" ? 1 : 0;
        },
      });
      assert.deepEqual(ran, ["test", "test:integration"]);
    });
  });

  void describe("when the browser lane fails", () => {
    void it("names the browser script rather than the jsdom one", () => {
      const outcome = outcomeOf(
        pkg("@fix/browser", ["test", "test:browser"]),
        new Map(),
        (script) => (script === "test:browser" ? 1 : 0),
      );
      assert.equal(outcome.failedScript, "test:browser");
    });
  });

  void describe("when the package is in the excluded register", () => {
    /** @scenario "An excluded package runs neither of its suites" */
    void it("runs none of its scripts and is reported as skipped", () => {
      const register = new Map([["@fix/elsewhere", "runs in its own workflow"]]);
      const elsewhere = pkg("@fix/elsewhere", ["test", "test:integration"]);
      assert.deepEqual(jobsFor([elsewhere], register), []);
      assert.deepEqual(
        outcomeOf(elsewhere, register, () => 1),
        {
          name: "@fix/elsewhere",
          outcome: "skipped",
          reason: "runs in its own workflow",
        },
      );
    });
  });
});

/** Runs `jobs` through the pool with controllable finishes, recording what overlapped. */
const pool = async (jobs: SuiteJob[], concurrency: number) => {
  const events: string[] = [];
  let running: string[] = [];
  let peak = 0;
  const overlaps: string[][] = [];
  const statuses = await runJobs({
    jobs,
    concurrency,
    run: async (job) => {
      const id = `${job.pkg.name} ${job.script}`;
      running = [...running, id];
      peak = Math.max(peak, running.length);
      overlaps.push(running);
      events.push(`start ${id}`);
      await new Promise((settle) => setTimeout(settle, 5));
      running = running.filter((other) => other !== id);
      events.push(`end ${id}`);
      return 0;
    },
  });
  return { events, peak, overlaps, statuses };
};

/** A stand-in child process: say something, then end with `code`. */
const fakeProcess = () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  return {
    child,
    say: (text: string) => child.stdout.emit("data", Buffer.from(text)),
    end: (code: number | null) => child.emit("close", code),
  };
};

/** A runner over fake processes, recording every log line and write in order. */
const fakeRunner = (live: boolean) => {
  const out: string[] = [];
  const processes = new Map<string, ReturnType<typeof fakeProcess>>();
  let clock = 0;
  const runner = createSuiteRunner({
    live,
    start: (job) => {
      const started = fakeProcess();
      processes.set(job.pkg.name, started);
      return started.child;
    },
    log: (line) => void out.push(line),
    write: (output) => void out.push(output.toString()),
    now: () => (clock += 3000),
  });
  return { runner, out, processes };
};

void describe("given the runner holds each suite's output until it ends", () => {
  void describe("when two suites print while both are running", () => {
    /** @scenario "A suite's output is printed as one group when it ends" */
    void it("prints each one as a single group, never interleaved", async () => {
      const { runner, out, processes } = fakeRunner(false);
      const first = runner.run({ pkg: pkg("@fix/a", ["test"]), script: "test" });
      const second = runner.run({ pkg: pkg("@fix/b", ["test"]), script: "test" });
      processes.get("@fix/a")!.say("a1 ");
      processes.get("@fix/b")!.say("b1 ");
      processes.get("@fix/a")!.say("a2");
      processes.get("@fix/b")!.end(0);
      processes.get("@fix/a")!.end(0);
      assert.deepEqual(await Promise.all([first, second]), [0, 0]);
      assert.deepEqual(out, [
        "started: @fix/a (packages/a) — pnpm run test",
        "started: @fix/b (packages/b) — pnpm run test",
        "::group::@fix/b (packages/b) — pnpm run test (3s)",
        "b1 ",
        "::endgroup::",
        "::group::@fix/a (packages/a) — pnpm run test (9s)",
        "a1 a2",
        "::endgroup::",
      ]);
    });
  });

  void describe("when a suite exits non-zero or is killed", () => {
    void it("settles with its exit code, or 1 when it has none", async () => {
      const { runner, processes } = fakeRunner(false);
      const failed = runner.run({ pkg: pkg("@fix/a", ["test"]), script: "test" });
      const killed = runner.run({ pkg: pkg("@fix/b", ["test"]), script: "test" });
      processes.get("@fix/a")!.end(2);
      processes.get("@fix/b")!.end(null);
      assert.deepEqual(await Promise.all([failed, killed]), [2, 1]);
    });
  });

  void describe("when a package runs two scripts", () => {
    void it("adds both durations to the package's measured seconds", async () => {
      const { runner, processes } = fakeRunner(false);
      const two = pkg("@fix/a", ["test", "test:integration"]);
      const unit = runner.run({ pkg: two, script: "test" });
      processes.get("@fix/a")!.end(0);
      await unit;
      const integration = runner.run({ pkg: two, script: "test:integration" });
      processes.get("@fix/a")!.end(0);
      await integration;
      assert.equal(runner.secondsOf.get("@fix/a"), 6);
    });
  });

  void describe("when the run is cancelled while a suite is still going", () => {
    /** @scenario "A cancelled run prints what its unfinished suites said" */
    void it("prints what that suite said so far as an unfinished group", () => {
      const { runner, out, processes } = fakeRunner(false);
      void runner.run({ pkg: pkg("@fix/a", ["test"]), script: "test" });
      processes.get("@fix/a")!.say("half way");
      runner.flushUnfinished();
      assert.deepEqual(out.slice(1), [
        "::group::@fix/a (packages/a) — pnpm run test (unfinished)",
        "half way",
        "::endgroup::",
      ]);
    });

    void it("prints it once, even if flushed again or the suite ends after", async () => {
      const { runner, out, processes } = fakeRunner(false);
      const done = runner.run({ pkg: pkg("@fix/a", ["test"]), script: "test" });
      processes.get("@fix/a")!.say("half way");
      runner.flushUnfinished();
      runner.flushUnfinished();
      processes.get("@fix/a")!.end(0);
      assert.equal(await done, 0);
      assert.deepEqual(out.slice(1), [
        "::group::@fix/a (packages/a) — pnpm run test (unfinished)",
        "half way",
        "::endgroup::",
      ]);
    });
  });

  void describe("when only one suite runs at a time", () => {
    void it("opens the group at the start and streams, holding nothing back", async () => {
      const { runner, out, processes } = fakeRunner(true);
      const done = runner.run({ pkg: pkg("@fix/a", ["test"]), script: "test" });
      processes.get("@fix/a")!.end(0);
      await done;
      runner.flushUnfinished();
      assert.deepEqual(out, ["::group::@fix/a (packages/a) — pnpm run test", "::endgroup::"]);
    });
  });

  void describe("when the script cannot be started", () => {
    void it("settles as failed and closes its group", async () => {
      const out: string[] = [];
      const runner = createSuiteRunner({
        live: false,
        start: () => {
          throw new Error("spawn ENOENT");
        },
        log: (line) => void out.push(line),
        write: (output) => void out.push(output.toString()),
      });
      assert.equal(await runner.run({ pkg: pkg("@fix/a", ["test"]), script: "test" }), 1);
      assert.equal(out.at(-1), "::endgroup::");
      assert.match(out.at(-2)!, /could not start pnpm run test: Error: spawn ENOENT/);
    });

    void it("prints why when the process reports the failure after starting", async () => {
      const { runner, out, processes } = fakeRunner(false);
      const done = runner.run({ pkg: pkg("@fix/a", ["test"]), script: "test" });
      processes.get("@fix/a")!.child.emit("error", new Error("spawn pnpm ENOENT"));
      processes.get("@fix/a")!.end(null);
      assert.equal(await done, 1);
      assert.match(out.join("\n"), /could not start pnpm run test: Error: spawn pnpm ENOENT/);
    });

    void it("logs why straight away when output is streamed", async () => {
      const { runner, out, processes } = fakeRunner(true);
      const done = runner.run({ pkg: pkg("@fix/a", ["test"]), script: "test" });
      processes.get("@fix/a")!.child.emit("error", new Error("spawn pnpm ENOENT"));
      assert.equal(await done, 1);
      assert.match(out[1]!, /could not start pnpm run test: Error: spawn pnpm ENOENT/);
    });
  });
});

void describe("given the lines the run prints around its suites", () => {
  void describe("when a package is excluded", () => {
    void it("says so, because a silent skip reads as never discovered", () => {
      assert.deepEqual(
        exclusionNotices(
          [pkg("@fix/elsewhere", ["test"]), pkg("@fix/here", ["test"])],
          new Map([["@fix/elsewhere", "runs in its own workflow"]]),
        ),
        ["not run: @fix/elsewhere — runs in its own workflow"],
      );
    });
  });

  void describe("when a package failed", () => {
    void it("annotates it with the script it is blamed on", () => {
      const lines = failureAnnotations([
        { name: "@fix/green", outcome: "passed" },
        { name: "@fix/red", outcome: "failed", failedScript: "test:integration" },
      ]);
      assert.equal(lines.length, 1);
      assert.match(lines[0]!, /^::error::@fix\/red failed \(pnpm run test:integration\)/);
    });
  });
});

void describe("given a shard that runs several suites at once", () => {
  void describe("when it has more suites than its concurrency", () => {
    /** @scenario "A shard runs several suites at once" */
    void it("runs up to that many at the same time, and every one of them", async () => {
      const packages = ["a", "b", "c", "d", "e"].map((name) => pkg(`@fix/${name}`, ["test"]));
      const { peak, statuses } = await pool(jobsFor(packages, new Map()), 3);
      assert.equal(peak, 3);
      assert.equal(statuses.size, 5);
    });
  });

  void describe("when two packages each declare an integration suite", () => {
    /** @scenario "Only one integration suite runs at a time" */
    void it("never overlaps them, while the unit suites still run alongside", async () => {
      const packages = ["a", "b", "c"].map((name) => pkg(`@fix/${name}`, ["test:integration"]));
      const units = ["d", "e"].map((name) => pkg(`@fix/${name}`, ["test"]));
      const { overlaps, peak } = await pool(jobsFor([...packages, ...units], new Map()), 3);
      for (const running of overlaps) {
        assert.ok(
          running.filter((id) => id.endsWith("test:integration")).length <= 1,
          running.join(),
        );
      }
      assert.ok(peak > 1);
    });
  });

  void describe("when a shard has heavy and light packages", () => {
    const heavy = ["a", "b"].map((name) => pkg(`@fix/heavy-${name}`, ["test", "test:integration"]));
    const light = ["c", "d", "e"].map((name) => pkg(`@fix/light-${name}`, ["test"]));
    const record = async (jobs: SuiteJob[]) => {
      const overlaps: string[][] = [];
      const events: string[] = [];
      let running: string[] = [];
      await runJobs({
        jobs,
        concurrency: 2,
        isHeavy: (candidate) => candidate.name.includes("heavy"),
        run: async (job) => {
          running = [...running, job.pkg.name];
          overlaps.push(running);
          events.push(`start ${job.pkg.name}`);
          await new Promise((settle) => setTimeout(settle, 5));
          running = running.filter((name) => name !== job.pkg.name);
          return 0;
        },
      });
      return { overlaps, events };
    };

    /** @scenario "A heavy suite runs alone" */
    void it("runs each heavy suite with nothing beside it, and light ones two at a time", async () => {
      const { overlaps } = await record(jobsFor([...heavy, ...light], new Map()));
      for (const together of overlaps) {
        if (together.some((name) => name.includes("heavy"))) {
          assert.equal(together.length, 1, together.join());
        }
      }
      assert.ok(overlaps.some((together) => together.length === 2));
    });

    /** @scenario "A heavy suite runs alone" */
    void it("starts every heavy suite before any light one, whatever the order given", async () => {
      const { events } = await record(jobsFor([light[0]!, ...heavy, ...light.slice(1)], new Map()));
      const lastHeavy = events.findLastIndex((event) => event.includes("heavy"));
      const firstLight = events.findIndex((event) => event.includes("light"));
      assert.ok(lastHeavy < firstLight, events.join("\n"));
    });

    /** @scenario "A heavy suite runs alone" */
    void it("counts a package as heavy from its recorded weight of 100 seconds", () => {
      const weights = new Map([
        ["@fix/light", 99],
        ["@fix/heavy", 100],
      ]);
      const weightOf = (candidate: DiscoveredPackage) => weights.get(candidate.name) ?? 0;
      assert.equal(isHeavyPackage({ weightOf, pkg: pkg("@fix/light", ["test"]) }), false);
      assert.equal(isHeavyPackage({ weightOf, pkg: pkg("@fix/heavy", ["test"]) }), true);
    });
  });

  void describe("when a shard's packages differ in recorded weight", () => {
    /** @scenario "A shard starts its heaviest suites first" */
    void it("orders them heaviest first, ties by name", () => {
      const weights = new Map([
        ["@fix/b", 50],
        ["@fix/slow", 300],
        ["@fix/a", 50],
      ]);
      const ordered = heaviestFirst({
        packages: ["@fix/b", "@fix/quick", "@fix/a", "@fix/slow"].map((name) =>
          pkg(name, ["test"]),
        ),
        weightOf: (candidate) => weights.get(candidate.name) ?? 5,
      });
      assert.deepEqual(
        ordered.map((candidate) => candidate.name),
        ["@fix/slow", "@fix/a", "@fix/b", "@fix/quick"],
      );
    });
  });

  void describe("when two packages each declare a browser suite", () => {
    /** @scenario "Only one browser suite runs at a time" */
    void it("never overlaps them", async () => {
      const packages = ["a", "b"].map((name) => pkg(`@fix/${name}`, ["test:browser"]));
      const { overlaps } = await pool(jobsFor(packages, new Map()), 3);
      for (const running of overlaps) assert.equal(running.length, 1);
    });
  });

  void describe("when a package has a unit suite and an integration suite", () => {
    /** @scenario "A package's own suites run one after another, in order" */
    void it("starts its integration suite only after its unit suite finished", async () => {
      const both = pkg("@fix/two-lane", ["test", "test:integration"]);
      const { events } = await pool(jobsFor([both, pkg("@fix/other", ["test"])], new Map()), 3);
      const ended = events.indexOf("end @fix/two-lane test");
      const started = events.indexOf("start @fix/two-lane test:integration");
      assert.ok(ended !== -1 && started > ended, events.join("\n"));
    });

    /** @scenario "A package's own suites run one after another, in order" */
    void it("keeps a later lane waiting while an earlier one waits for its slot", async () => {
      const three = pkg("@fix/three-lane", ["test", "test:integration", "test:browser"]);
      const holder = pkg("@fix/holder", ["test:integration"]);
      const events: string[] = [];
      await runJobs({
        jobs: jobsFor([holder, three], new Map()),
        concurrency: 3,
        run: async (job) => {
          events.push(`start ${job.pkg.name} ${job.script}`);
          // The holder keeps the integration slot after the unit suite is done.
          const ms = job.pkg === holder ? 20 : 5;
          await new Promise((settle) => setTimeout(settle, ms));
          events.push(`end ${job.pkg.name} ${job.script}`);
          return 0;
        },
      });
      const integrationEnded = events.indexOf("end @fix/three-lane test:integration");
      const browserStarted = events.indexOf("start @fix/three-lane test:browser");
      assert.ok(integrationEnded !== -1 && browserStarted > integrationEnded, events.join("\n"));
    });
  });

  void describe("when a suite cannot be started at all", () => {
    void it("counts it as failed and runs the rest", async () => {
      const packages = ["a", "b"].map((name) => pkg(`@fix/${name}`, ["test"]));
      const statuses = await runJobs({
        jobs: jobsFor(packages, new Map()),
        concurrency: 2,
        run: async (job) => {
          if (job.pkg.name === "@fix/a") throw new Error("spawn ENOENT");
          return 0;
        },
      });
      assert.deepEqual(
        [...statuses].map(([job, status]) => `${job.pkg.name} ${status}`).toSorted(),
        ["@fix/a 1", "@fix/b 0"],
      );
    });
  });
});

void describe("given the scripts a package declares", () => {
  void it("puts integration and browser scripts in lanes of their own", () => {
    assert.equal(laneOf("test:integration"), "integration");
    assert.equal(laneOf("test:browser"), "browser");
    assert.equal(laneOf("test"), "shared");
    assert.equal(laneOf("test:unit"), "shared");
  });
});

void describe("given a suite the shard is about to start", () => {
  const job = (name: string, script: string) => ({
    pkg: { name, dir: `modules/${name}`, scripts: [script] },
    script,
  });

  void describe("when it is a heavy package's unit suite on four cores", () => {
    /** @scenario "A heavy unit suite running alone uses every core" */
    void it("asks vitest for four workers", () => {
      assert.deepEqual(workerEnvFor({ job: job("@fix/trace", "test"), heavy: true, cores: 4 }), {
        VITEST_MAX_WORKERS: "4",
      });
    });
  });

  void describe("when it needs a quiet CPU or shares a datastore", () => {
    /** @scenario "A heavy suite that needs a quiet CPU keeps the launcher's workers" */
    void it("adds nothing for design-system, integration, browser or light suites", () => {
      const cases = [
        { job: job("@langwatch/design-system", "test"), heavy: true },
        { job: job("@fix/trace", "test:integration"), heavy: true },
        { job: job("@fix/trace", "test:browser"), heavy: true },
        { job: job("@fix/small", "test"), heavy: false },
      ];
      for (const { job: suite, heavy } of cases) {
        assert.deepEqual(workerEnvFor({ job: suite, heavy, cores: 4 }), {});
      }
    });
  });
});

void describe("given PACKAGE_SUITES_CONCURRENCY", () => {
  void describe("when it is not set", () => {
    /** @scenario "Without a concurrency setting the suites run one at a time" */
    void it("runs one suite at a time", () => {
      assert.equal(parseConcurrency(undefined), 1);
      assert.equal(parseConcurrency(""), 1);
    });
  });

  void describe("when it is a positive whole number", () => {
    void it("uses it", () => {
      assert.equal(parseConcurrency("3"), 3);
    });
  });

  void describe("when it is malformed", () => {
    /** @scenario "A malformed concurrency value is refused" */
    void it("refuses it", () => {
      for (const value of ["0", "-1", "2.5", "three"]) {
        assert.throws(() => parseConcurrency(value), /PACKAGE_SUITES_CONCURRENCY/);
      }
    });
  });
});

void describe("given the outcomes of a whole run", () => {
  void describe("when one package failed", () => {
    void it("names it in the summary", () => {
      const outcomes: SuiteOutcome[] = [
        { name: "@fix/green", outcome: "passed" },
        { name: "@fix/red", outcome: "failed", failedScript: "test" },
        { name: "@fix/elsewhere", outcome: "skipped", reason: "own workflow" },
      ];
      const summary = summarise(outcomes).join("\n");
      assert.match(summary, /\| passed \| 1 \|/);
      assert.match(summary, /\| failed \| 1 \|/);
      assert.match(summary, /\| excluded \(registered, not run\) \| 1 \|/);
      assert.match(summary, /Failed: @fix\/red/);
    });
  });

  void describe("when everything passed", () => {
    void it("names no failures", () => {
      const summary = summarise([{ name: "@fix/green", outcome: "passed" }]).join("\n");
      assert.doesNotMatch(summary, /Failed:/);
    });
  });
});

void describe("given the job is split into shards", () => {
  void describe("when every shard of a split takes its share", () => {
    /** @scenario "Every package lands on exactly one shard" */
    void it("runs each package on exactly one shard", () => {
      const items = ["a", "b", "c", "d", "e", "f", "g"].map((name) => ({ name }));
      const weightOf = () => 1;
      const shares = [1, 2, 3].map((index) =>
        shardOf({ items, weightOf, shard: { index, total: 3 } }),
      );
      assert.deepEqual(
        shares
          .flat()
          .map((p) => p.name)
          .toSorted(),
        ["a", "b", "c", "d", "e", "f", "g"],
      );
    });
  });

  void describe("when the packages differ in how long they take", () => {
    const weights = new Map([
      ["slow", 600],
      ["mid", 300],
      ["a", 200],
      ["b", 200],
      ["c", 200],
    ]);
    const items = ["a", "b", "c", "mid", "slow"].map((name) => ({ name }));
    const weightOf = (p: { name: string }) => weights.get(p.name) ?? DEFAULT_WEIGHT_SECONDS;

    /** @scenario "Shards are balanced by measured weight" */
    void it("places the heaviest first, each on the lightest shard", () => {
      const groups = balanceShards({ items, weightOf, total: 2 }).map((g) => g.map((p) => p.name));
      assert.deepEqual(groups, [
        ["c", "slow"],
        ["a", "b", "mid"],
      ]);
    });

    /** @scenario "Shards are balanced by the wall time each package adds" */
    void it("weighs a heavy package whole and a light one by its share of the concurrency", () => {
      const seconds = new Map([
        ["heavy", 200],
        ["l1", 90],
        ["l2", 90],
        ["l3", 90],
        ["l4", 90],
      ]);
      const items = ["heavy", "l1", "l2", "l3", "l4"].map((name) => ({ name, scripts: ["test"] }));
      const weightOf = (p: { name: string }) => seconds.get(p.name) ?? 0;
      const { groups, walls } = balanceByWallTime({ items, weightOf, concurrency: 2, total: 2 });
      // By raw seconds l4 joined the heavy package: 200 + 90/2 against 270/2.
      assert.deepEqual(
        groups.map((g) => g.map((p) => p.name)),
        [["heavy"], ["l1", "l2", "l3", "l4"]],
      );
      assert.deepEqual(walls, [200, 180]);
    });

    /** @scenario "Shards are balanced by the wall time each package adds" */
    void it("counts an integration lane at full weight, since it runs one suite at a time", () => {
      const seconds = new Map([
        ["heavy", 150],
        ["i1", 90],
        ["i2", 90],
        ["i3", 90],
      ]);
      const items = [
        { name: "heavy", scripts: ["test"] },
        ...["i1", "i2", "i3"].map((name) => ({ name, scripts: ["test:integration"] })),
      ];
      const weightOf = (p: { name: string }) => seconds.get(p.name) ?? 0;
      const { groups, walls } = balanceByWallTime({ items, weightOf, concurrency: 2, total: 2 });
      // Counted at half weight, all three joined one shard and ran 270s back to back.
      assert.deepEqual(
        groups.map((g) => g.map((p) => p.name)),
        [["heavy", "i3"], ["i1", "i2"]],
      );
      assert.deepEqual(walls, [240, 180]);
    });

    /** @scenario "Shards are balanced by the wall time each package adds" */
    void it("spreads a light package's weight over its scripts' lanes", () => {
      const load = withPackage({
        load: { alone: 0, shared: 0, integration: 0, browser: 0 },
        weight: 60,
        scripts: ["test", "test:integration", "test:browser"],
      });
      assert.deepEqual(load, { alone: 0, shared: 60, integration: 20, browser: 20 });
      assert.equal(wallTimeOf({ load, concurrency: 2 }), 30);
    });

    /** @scenario "Every shard computes the same split" */
    void it("gives the same split whatever order the packages arrive in", () => {
      const split = (list: typeof items) =>
        balanceShards({ items: list, weightOf, total: 3 }).map((g) =>
          g.map((p) => p.name).toSorted(),
        );
      assert.deepEqual(split(items), split(items.toReversed()));
    });
  });

  void describe("when a package is missing from the weights", () => {
    /** @scenario "A package with no recorded weight still lands on a shard" */
    void it("is weighed at the default and assigned like any other", () => {
      const { weights } = parseWeights("known  100\n", "weights");
      const weightOf = (p: { name: string }) => weights.get(p.name) ?? DEFAULT_WEIGHT_SECONDS;
      const items = [{ name: "known" }, { name: "new-a" }, { name: "new-b" }];
      assert.equal(weightOf(items[1]), DEFAULT_WEIGHT_SECONDS);
      const placed = balanceShards({ items, weightOf, total: 2 })
        .flat()
        .map((p) => p.name)
        .toSorted();
      assert.deepEqual(placed, ["known", "new-a", "new-b"]);
    });
  });

  void describe("when a pull request narrows the packages", () => {
    /** @scenario "A pull request balances over only the packages it reaches" */
    void it("balances over just the packages given, not the whole workspace", () => {
      const reached = [{ name: "big" }, { name: "small-a" }, { name: "small-b" }];
      const weightOf = (p: { name: string }) => (p.name === "big" ? 300 : 100);
      const groups = balanceShards({ items: reached, weightOf, total: 2 });
      assert.deepEqual(
        groups.map((g) => g.map((p) => p.name)),
        [["big"], ["small-a", "small-b"]],
      );
    });
  });

  void describe("given the weights file", () => {
    /** @scenario "A malformed weights file is refused" */
    void it("reads a package and its seconds, skipping blanks and comments", () => {
      const { weights, errors } = parseWeights(
        "# header\n\n@fix/a  120\n@fix/b 45.5  # note\n",
        "weights",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(
        [...weights],
        [
          ["@fix/a", 120],
          ["@fix/b", 45.5],
        ],
      );
    });

    void it("refuses a missing, zero, non-numeric, infinite or repeated weight", () => {
      const infinite = `@fix/a  ${"9".repeat(400)}`;
      for (const bad of ["@fix/a", "@fix/a  0", "@fix/a  slow", infinite, "@fix/a 1\n@fix/a 2"]) {
        assert.equal(parseWeights(bad, "weights").errors.length, 1, bad);
      }
    });

    void it("prints the slow packages of a run in its own format", () => {
      assert.deepEqual(
        formatMeasured([
          { name: "@fix/quick", seconds: 3 },
          { name: "@fix/slow", seconds: 120.4 },
          { name: "@fix/slower", seconds: 640 },
        ]),
        ["@fix/slower  640", "@fix/slow  120"],
      );
    });
  });

  void describe("when no shard is named", () => {
    void it("runs everything on one shard", () => {
      assert.deepEqual(parseShard(undefined), { index: 1, total: 1 });
    });
  });

  void describe("when the shard value is malformed", () => {
    /** @scenario "A malformed shard value is refused" */
    void it("refuses it rather than running everything on every leg", () => {
      assert.throws(() => parseShard("0/4"));
      assert.throws(() => parseShard("5/4"));
      assert.throws(() => parseShard("two"));
    });
  });
});

void describe("given the list of projects a pull request reaches", () => {
  void describe("when the list is present", () => {
    /** @scenario "A pull request runs only the suites its change reaches" */
    void it("keeps exactly the named packages", () => {
      const only = parseOnly('["@fix/reached","@fix/also"]');
      assert.deepEqual([...(only ?? [])], ["@fix/reached", "@fix/also"]);
    });
  });

  void describe("when there is no list", () => {
    /** @scenario "Without an affected list every suite runs" */
    void it("narrows nothing", () => {
      assert.equal(parseOnly(undefined), undefined);
      assert.equal(parseOnly(""), undefined);
    });
  });

  void describe("when the list is malformed", () => {
    void it("is an error, never a silent whole or empty run", () => {
      assert.throws(() => parseOnly("not json"), /PACKAGE_SUITES_ONLY/);
      assert.throws(() => parseOnly('{"a":1}'), /PACKAGE_SUITES_ONLY/);
    });
  });
});

void describe("given a suite script", () => {
  const pkg: DiscoveredPackage = { name: "@fix/a", dir: "packages/a", scripts: [] };

  /** @scenario "A suite Nx caches runs through Nx" */
  void it("runs a cached script through Nx without rebuilding its dependencies", () => {
    for (const script of ["test", "test:unit"]) {
      const command = commandFor({ pkg, script });
      assert.deepEqual(command.slice(0, 3), ["exec", "nx", "run-many"]);
      assert.ok(command.includes(script) && command.includes("@fix/a"));
      assert.ok(command.includes("--excludeTaskDependencies"));
    }
  });

  /** @scenario "An integration or browser suite runs uncached" */
  void it("runs the integration and browser lanes through pnpm", () => {
    for (const script of ["test:integration", "test:browser"]) {
      assert.deepEqual(commandFor({ pkg, script }), ["--filter", "@fix/a", "run", script]);
    }
  });
});
