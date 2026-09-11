/**
 * @vitest-environment node
 * The per-module install seam: where a module's OWN collaborators come from.
 *
 * A module's members have two sources and they are complements. The names it
 * declared with `reads(...)` are the process's, off the one pool every module
 * shares. The rest are the module's own - a monitor's evaluator reader, a
 * feature flag's slot cache - and `withModule(module, { members })` is where a
 * process hands those in, for that one module.
 */
import { describe, expect, it } from "vitest";

import {
  type ApplicationBuilder,
  createApp,
  type ModuleMembersGuard,
  type ModuleMembersMissing,
} from "../application.ts";
import { defineServerModule, type FeatureSetup } from "../feature-installer.ts";
import {
  DuplicateModuleMemberError,
  membersFrom,
  MissingMemberError,
} from "../module-members.ts";

/** One member the pool answers for every module that reads it. */
type Clock = Readonly<{ now: () => number }>;

/** A port exactly one module has a use for, so no pool could hold it. */
interface EvaluatorReader {
  evaluatorFor(id: string): string;
}

const clock: Clock = { now: () => 1_700_000_000_000 };
const evaluators: EvaluatorReader = { evaluatorFor: (id) => `evaluator:${id}` };

/** The pool a process states, and the source that answers off it. */
type Pool = Readonly<{ clock: Clock }>;
const poolOf = () => membersFrom<Pool>({ clock });

abstract class ReportApp {
  abstract readonly report: string;
}

/** Members that are wholly the module's own: nothing here is pool-shaped. */
type OwnMembers = Readonly<{ evaluators: EvaluatorReader; generateId: () => string }>;

class OwnMembersApp extends ReportApp {
  static readonly contract = ReportApp;
  static readonly dependencies = {};

  private constructor(readonly report: string) {
    super();
  }

  static create(
    setup: FeatureSetup<typeof OwnMembersApp.dependencies, OwnMembers, undefined>,
  ): OwnMembersApp {
    return new OwnMembersApp(
      `${setup.members.evaluators.evaluatorFor("check")}/${setup.members.generateId()}`,
    );
  }
}

/** One member off the pool, one of its own - the shape `suite` actually has. */
type MixedMembers = Readonly<{ clock: Clock; evaluators: EvaluatorReader }>;

class MixedMembersApp extends ReportApp {
  static readonly contract = ReportApp;
  static readonly dependencies = {};
  static readonly reads = ["clock"] as const;

  private constructor(readonly report: string) {
    super();
  }

  static create(
    setup: FeatureSetup<typeof MixedMembersApp.dependencies, MixedMembers, undefined>,
  ): MixedMembersApp {
    return new MixedMembersApp(
      `${setup.members.clock.now()}/${setup.members.evaluators.evaluatorFor("check")}`,
    );
  }
}

/** Everything it reads is the pool's, so its install hands it nothing. */
class PoolOnlyApp extends ReportApp {
  static readonly contract = ReportApp;
  static readonly dependencies = {};
  static readonly reads = ["clock"] as const;

  private constructor(readonly report: string) {
    super();
  }

  static create(
    setup: FeatureSetup<typeof PoolOnlyApp.dependencies, Readonly<{ clock: Clock }>, undefined>,
  ): PoolOnlyApp {
    return new PoolOnlyApp(String(setup.members.clock.now()));
  }
}

/** Reads nothing at all, so neither source has anything to say. */
class NoMembersApp extends ReportApp {
  static readonly contract = ReportApp;
  static readonly dependencies = {};

  private constructor(readonly report: string) {
    super();
  }

  static create(
    _setup: FeatureSetup<typeof NoMembersApp.dependencies, undefined, undefined>,
  ): NoMembersApp {
    return new NoMembersApp("nothing read");
  }
}

const ownMembersServer = defineServerModule("monitor").withApp(OwnMembersApp).build();
const mixedMembersServer = defineServerModule("suite").withApp(MixedMembersApp).build();
const poolOnlyServer = defineServerModule("share").withApp(PoolOnlyApp).build();
const noMembersServer = defineServerModule("presence").withApp(NoMembersApp).build();

describe("withModule", () => {
  describe("given a module whose members are its own", () => {
    it("hands the bag it was installed with to the app", async () => {
      const runtime = await createApp({ role: "api" })
        .withModule(ownMembersServer, {
          members: { evaluators, generateId: () => "monitor_1" },
        })
        .boot();

      try {
        expect(runtime.service(ReportApp).report).toBe("evaluator:check/monitor_1");
      } finally {
        await runtime.stop();
      }
    });

    it("refuses the install that hands it none, naming every member", () => {
      const builder = createApp({ role: "api" });

      // The refusal is the compiler's and this directive is the assertion for
      // it: the bespoke half of a Members bag exists only in the type, so boot
      // has no name to print. What used to happen instead is the whole bug -
      // the app was handed a frozen `{}` cast to this type and every
      // collaborator was `undefined` on the first line that read one.
      // @ts-expect-error - a module whose members are its own is not installable without them
      const refused = builder.withModule(ownMembersServer);

      expect(refused).toBe(builder);
    });

    it("names the members in the refusal a reader sees", () => {
      const named: ModuleMembersMissing<"evaluators" | "generateId"> = {
        "members this module's install must hand it": "evaluators",
      };
      // Both directions, so the guard names exactly these two members rather
      // than a superset that happens to contain them. The package typecheck is
      // the assertion: this is the message the compiler prints at the call.
      const asRefusal: ModuleMembersGuard<OwnMembers, unknown> = named;
      const asNamed: ModuleMembersMissing<"evaluators" | "generateId"> = asRefusal;

      expect(asNamed["members this module's install must hand it"]).toBe("evaluators");
    });
  });

  describe("given a module that reads one member off the pool and owns the rest", () => {
    it("takes the pool member from the process and the rest from the install", async () => {
      const runtime = await createApp({ role: "api", members: poolOf() })
        .withModule(mixedMembersServer, { members: { evaluators } })
        .boot();

      try {
        expect(runtime.service(ReportApp).report).toBe("1700000000000/evaluator:check");
      } finally {
        await runtime.stop();
      }
    });

    it("refuses a bag that names a member the module already reads off the pool", async () => {
      await expect(
        createApp({ role: "api", members: poolOf() })
          // The two sources are complements, and a name claimed by both has no
          // answer to which one the app got. Boot is what refuses it: the bag's
          // type admits every name the module's members have, because a
          // process installing through a helper generic over its own pool
          // could not be held to the narrower one.
          .withModule(mixedMembersServer, { members: { evaluators, clock } })
          .boot(),
      ).rejects.toThrow(DuplicateModuleMemberError);
    });
  });

  describe("given a module whose members the pool answers in full", () => {
    it("asks its install for nothing, so one argument installs it", () => {
      // `unknown` satisfies the guard only where it resolved to nothing, which
      // is what makes `withModule(module)` legal for this module and not for
      // the one above.
      const nothingToHand: ModuleMembersGuard<Readonly<{ clock: Clock }>, Pool> = "nothing";

      expect(nothingToHand).toBe("nothing");
    });

    it("installs with no bag at all", async () => {
      const runtime = await createApp({ role: "api", members: poolOf() })
        .withModule(poolOnlyServer)
        .boot();

      try {
        expect(runtime.service(ReportApp).report).toBe("1700000000000");
      } finally {
        await runtime.stop();
      }
    });

    it("still refuses a member this process cannot supply, by name", async () => {
      await expect(
        createApp({ role: "api", members: membersFrom<Pool>({}) })
          .withModule(poolOnlyServer)
          .boot(),
      ).rejects.toThrow(new MissingMemberError("share", "clock").message);
    });
  });

  describe("given a module that reads nothing", () => {
    it("installs on one argument, with neither source asked for anything", async () => {
      const runtime = await createApp({ role: "api" }).withModule(noMembersServer).boot();

      try {
        expect(runtime.service(ReportApp).report).toBe("nothing read");
        expect(runtime.module(noMembersServer).provided).toBe(runtime.service(ReportApp));
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("given the same module installed both ways", () => {
    it("makes withModule with no bag mean exactly what withModules means", async () => {
      const one = await createApp({ role: "api", members: poolOf() })
        .withModule(poolOnlyServer)
        .boot();
      const two = await createApp({ role: "api", members: poolOf() })
        .withModules([poolOnlyServer])
        .boot();

      try {
        expect(one.service(ReportApp).report).toBe(two.service(ReportApp).report);
        expect(one.module(poolOnlyServer).provided).toBe(one.service(ReportApp));
      } finally {
        await one.stop();
        await two.stop();
      }
    });
  });
});

/**
 * The shape a worker's own installer has: a function generic over the pool,
 * handing one module the collaborators that are its own.
 *
 * It is here as a compile-time fixture and nothing else. `ModuleBag` subtracts
 * what the pool answers, so an unresolved pool leaves the subtraction deferred,
 * and this is the one call shape where that could turn a correct install into a
 * type error. The package typecheck is the assertion.
 */
function installIntoAnyPool<AnyPool>(
  builder: ApplicationBuilder<AnyPool>,
): ApplicationBuilder<AnyPool> {
  return builder.withModule(ownMembersServer, {
    members: { evaluators, generateId: () => "monitor_1" },
  });
}

void installIntoAnyPool;

/**
 * The same installer, for a module whose members the pool answers in full.
 *
 * One argument, and the guard that would refuse a missing bag is unresolved
 * here for the same reason the subtraction is. Compile-time fixture only.
 */
function installPoolOnlyIntoAnyPool<AnyPool>(
  builder: ApplicationBuilder<AnyPool>,
): ApplicationBuilder<AnyPool> {
  return builder.withModule(poolOnlyServer);
}

void installPoolOnlyIntoAnyPool;
