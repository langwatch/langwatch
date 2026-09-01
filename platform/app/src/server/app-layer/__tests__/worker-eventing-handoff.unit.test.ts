/**
 * Who claims `event-sourcing/jobs`, and which composition sites answer to that.
 *
 * The cutover puts a second Eventing graph in the worker process — the packaged
 * `WorkerProductionComposition` — and exactly one of the two may consume the
 * shared queue. Two consumers in one pod double every job; none stalls the
 * fleet. So the decision is one boolean, and the value of this file is that the
 * boolean is right AND that the three sites which make a process a consumer are
 * the three that read it.
 *
 * Both halves are needed and neither is enough alone. A correct predicate no
 * site reads changes nothing; a site reading a wrong predicate is the outage.
 *
 * The second half reads `presets.ts` through the TypeScript AST rather than
 * booting it. Booting is not available here, and not for want of trying:
 * `initializeDefaultApp` composes the whole process graph, and three separate
 * things stop a unit lane from running it — `registerAll()` needs a ClickHouse
 * event store (CI's unit shard sets `BUILD_TIME=true`, which disables one),
 * `configureClickHouseRuntime` is a process singleton that throws on the second
 * composition so no test file could cover more than one role, and a completed
 * boot starts a scheduler and a Redis connection. Reading the AST costs the
 * end-to-end observation and buys assertions that source comments, dead code
 * and renamed locals cannot satisfy.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  Expression,
  FunctionDeclaration,
  IfStatement,
  Node,
  PropertyAssignment,
  VariableDeclaration,
} from "typescript/unstable/ast";
import {
  isCallExpression,
  isConditionalExpression,
  isFunctionDeclaration,
  isIdentifier,
  isIfStatement,
  isNewExpression,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isStringLiteral,
  isVariableDeclaration,
} from "typescript/unstable/ast";
import { describe, expect, it } from "vitest";
import { parseSourceText } from "~/test-utils/tsAst";
import { appOwnsEventingConsumersFor } from "../worker-eventing-handoff";

describe("eventing consumer ownership", () => {
  describe("given no option, which is what every caller passed before the cutover", () => {
    it.each([
      ["worker", true],
      ["all", true],
      ["web", false],
      ["migration", false],
    ] as const)("leaves the %s role exactly as it is today: %s", (processRole, owns) => {
      expect(appOwnsEventingConsumersFor({ eventingConsumers: undefined, processRole })).toBe(owns);
    });

    it("owns nothing when the role is unset", () => {
      expect(
        appOwnsEventingConsumersFor({ eventingConsumers: undefined, processRole: undefined }),
      ).toBe(false);
    });
  });

  describe("when the caller names the App as the owner", () => {
    it.each([
      ["worker", true],
      ["all", true],
      ["web", false],
      ["migration", false],
    ] as const)("answers the same as the absent option for %s: %s", (processRole, owns) => {
      expect(appOwnsEventingConsumersFor({ eventingConsumers: "app-owned", processRole })).toBe(
        owns,
      );
    });
  });

  describe("when the caller hands the consumers to an external composition", () => {
    it.each(["worker", "all", "web", "migration"] as const)(
      "gives the %s role a producer-only App",
      (processRole) => {
        expect(appOwnsEventingConsumersFor({ eventingConsumers: "external", processRole })).toBe(
          false,
        );
      },
    );
  });
});

const PRESETS_PATH = fileURLToPath(new URL("../presets.ts", import.meta.url));
const PRESETS_SOURCE = readFileSync(PRESETS_PATH, "utf8");

function collect<Found extends Node>(
  node: Node,
  matches: (candidate: Node) => candidate is Found,
): Found[] {
  const found: Found[] = [];
  const walk = (candidate: Node): void => {
    if (matches(candidate)) found.push(candidate);
    candidate.forEachChild(walk);
  };
  walk(node);
  return found;
}

/** `foo`, `a.b`, `a?.b` — anything else reads as undefined rather than guessing. */
function referencePath(expression: Expression | undefined): string | undefined {
  if (!expression) return undefined;
  if (isIdentifier(expression)) return expression.text;
  if (isPropertyAccessExpression(expression) && isIdentifier(expression.name)) {
    const target = referencePath(expression.expression);
    if (target === undefined) return undefined;
    return `${target}${expression.questionDotToken ? "?." : "."}${expression.name.text}`;
  }
  return undefined;
}

function calleeOf(expression: Expression | undefined): string | undefined {
  if (!expression || !isCallExpression(expression)) return undefined;
  return referencePath(expression.expression);
}

/** The callee of the condition a `x ? y : z` initializer tests, if it tests a call. */
function conditionCalleeOf(declaration: VariableDeclaration): string | undefined {
  const initializer = declaration.initializer;
  if (!initializer || !isConditionalExpression(initializer)) return undefined;
  return calleeOf(initializer.condition);
}

function declarationName(declaration: VariableDeclaration): string | undefined {
  return isIdentifier(declaration.name) ? declaration.name.text : undefined;
}

function propertyKey(property: Node): string | undefined {
  if (!isPropertyAssignment(property) && !isShorthandPropertyAssignment(property)) return undefined;
  return isIdentifier(property.name) ? property.name.text : undefined;
}

/**
 * Every `key: <reference>` and every `key` shorthand in an object literal, as
 * the local each one names. A key built from anything richer than a reference
 * is absent rather than approximated, so an assertion on this record can only
 * be satisfied by the literal naming those locals.
 */
function objectLiteralReferences(expression: Expression | undefined): Record<string, string> {
  if (!expression || !isObjectLiteralExpression(expression)) return {};
  const entries: Record<string, string> = {};
  for (const property of expression.properties) {
    const key = propertyKey(property);
    if (key === undefined) continue;
    if (isShorthandPropertyAssignment(property)) {
      entries[key] = key;
      continue;
    }
    if (!isPropertyAssignment(property)) continue;
    const value = referencePath(property.initializer);
    if (value !== undefined) entries[key] = value;
  }
  return entries;
}

/** The value an object literal assigns to `key`, whatever shape it has. */
function propertyValue(expression: Expression | undefined, key: string): Expression | undefined {
  if (!expression || !isObjectLiteralExpression(expression)) return undefined;
  for (const property of expression.properties) {
    if (propertyKey(property) === key && isPropertyAssignment(property))
      return property.initializer;
  }
  return undefined;
}

const PRESETS = parseSourceText({ fileName: "presets.ts", sourceText: PRESETS_SOURCE });

function declaredFunction(name: string): FunctionDeclaration {
  const found = PRESETS.statements.find(
    (statement): statement is FunctionDeclaration =>
      isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  if (!found) throw new Error(`${name} is no longer declared in ${PRESETS_PATH}`);
  return found;
}

const composition = declaredFunction("initializeDefaultApp");

const declarations = collect(composition, isVariableDeclaration);
const conditionals = collect(composition, isIfStatement);

function declaration(name: string): VariableDeclaration {
  const found = declarations.find((candidate) => declarationName(candidate) === name);
  if (!found) throw new Error(`initializeDefaultApp declares no ${name}`);
  return found;
}

function gateAround(callee: string): IfStatement {
  const found = conditionals.find((candidate) =>
    collect(candidate.thenStatement, isCallExpression).some(
      (call) => referencePath(call.expression) === callee,
    ),
  );
  if (!found) throw new Error(`no if statement in initializeDefaultApp calls ${callee}()`);
  return found;
}

describe("the App composition's consumer gates", () => {
  describe("given the one decision the three consumer sites share", () => {
    it("computes it from the caller's option and the process role", () => {
      const computed = declaration("appOwnsEventingConsumers");

      expect(calleeOf(computed.initializer)).toBe("appOwnsEventingConsumersFor");
      expect(
        objectLiteralReferences(
          isCallExpression(computed.initializer!) ? computed.initializer.arguments[0] : undefined,
        ),
      ).toEqual({
        eventingConsumers: "options?.eventingConsumers",
        processRole: "config.processRole",
      });
    });
  });

  describe("given the worker entry point a packaged composition boots through", () => {
    /**
     * `initializeWorkerApp()` is what `workers.ts` calls, and the packaged
     * composition root calls it with `eventingConsumers: "external"`. It has to
     * pass the option on: swallowed here, the App claims the queue while the
     * packaged graph claims it too, and the process consumes every job twice.
     */
    it("forwards the caller's options and fixes only the role", () => {
      const entry = declaredFunction("initializeWorkerApp");
      const call = collect(entry, isCallExpression).find(
        (candidate) => referencePath(candidate.expression) === "initializeDefaultApp",
      );
      const composed = call?.arguments[0];

      expect(
        composed && isObjectLiteralExpression(composed)
          ? composed.properties
              .filter(isSpreadAssignment)
              .map((spread) => referencePath(spread.expression))
          : [],
      ).toEqual(["options"]);
      const role = propertyValue(composed, "processRole");
      expect(role && isStringLiteral(role) ? role.text : undefined).toBe("worker");
    });
  });

  describe("when the queue factory and its runtime are built", () => {
    /**
     * Both, or neither is worth anything: the factory's flag is what
     * instantiates a `GroupQueueConsumer` per queue definition, and the
     * runtime's is what routes jobs to handlers. One left on the role would
     * claim the queue while the packaged composition also claimed it.
     */
    it("passes the same decision to both consumersEnabled sites", () => {
      const sites = collect(composition, isPropertyAssignment).filter(
        (property: PropertyAssignment) => propertyKey(property) === "consumersEnabled",
      );

      expect(sites).toHaveLength(2);
      expect(sites.map((site) => referencePath(site.initializer))).toEqual([
        "appOwnsEventingConsumers",
        "appOwnsEventingConsumers",
      ]);
    });
  });

  describe("when the one-time boot seeds run", () => {
    it("gates them on consumer ownership rather than on the role", () => {
      expect(referencePath(gateAround("topic.startBootSeeds").expression)).toBe(
        "appOwnsEventingConsumers",
      );
    });
  });

  describe("given the worker-process responsibilities that are not consumers", () => {
    /**
     * A scheduler, a report handler, a scenario pool, the governance pull
     * arming and the system-migration pass belong to the worker PROCESS. They
     * stay on the role, because handing the queue to another composition in the
     * same process does not move any of them out of it.
     */
    it("leaves every one of them keyed on the role", () => {
      const roleGated = declarations
        .filter((candidate) => conditionCalleeOf(candidate) === "roleRunsWorkers")
        .map(declarationName)
        .sort();

      expect(roleGated).toEqual([
        "scenarioExecutionPool",
        "scheduler",
        "systemMigrations",
        "workerEventingHandoff",
      ]);
      expect(
        conditionals.filter((candidate) => calleeOf(candidate.expression) === "roleRunsWorkers"),
      ).toHaveLength(1);
      expect(
        collect(composition, isCallExpression).filter(
          (call) => referencePath(call.expression) === "roleRunsWorkers",
        ),
      ).toHaveLength(6);
    });

    it("gates nothing but the boot seeds on consumer ownership", () => {
      expect(
        conditionals.filter(
          (candidate) => referencePath(candidate.expression) === "appOwnsEventingConsumers",
        ),
      ).toHaveLength(1);
    });
  });

  describe("given the handoff a packaged worker composition reads", () => {
    const populatedHandoff = (): Expression => {
      const initializer = declaration("workerEventingHandoff").initializer;
      if (!initializer || !isConditionalExpression(initializer)) {
        throw new Error("workerEventingHandoff is no longer conditional on the process role");
      }
      expect(referencePath(initializer.whenFalse)).toBe("undefined");
      return initializer.whenTrue;
    };

    it("reports the decision the App itself acted on", () => {
      const populated = populatedHandoff();

      expect(objectLiteralReferences(populated).appOwnsEventingConsumers).toBe(
        "appOwnsEventingConsumers",
      );
      expect(objectLiteralReferences(populated).isSaas).toBe("config.isSaas");
    });

    /**
     * Instances, not a recipe. Two Eventing runtimes over two Redis connections
     * would offload payloads through two staging paths; over these locals they
     * are one substrate with two graphs on it, which is what makes the second
     * graph's bytes identical to the first's.
     */
    it("hands over the same objects the App's own runtime was built from", () => {
      const populated = populatedHandoff();

      expect(objectLiteralReferences(propertyValue(populated, "substrate"))).toEqual({
        prisma: "prisma",
        resolveClickHouseClient: "resolveClickHouseClient",
        groupQueue: "groupQueueDependencies",
        persistenceRetention: "eventingPersistenceRetention",
        retentionPolicyResolver: "eventingRetention",
        replayMarkerChecker: "replayMarkerChecker",
      });
      expect(objectLiteralReferences(populated).topic).toBe("topicInstallerDependencies");
    });

    it("names the very locals the App's queue factory and runtime read", () => {
      const factoryCall = collect(composition, isCallExpression).find(
        (call) => referencePath(call.expression) === "createEventingGroupQueueFactory",
      );
      const runtime = collect(composition, isNewExpression).find(
        (construction) => referencePath(construction.expression) === "EventSourcing",
      );

      expect(objectLiteralReferences(factoryCall?.arguments[0]).dependencies).toBe(
        "groupQueueDependencies",
      );
      expect(objectLiteralReferences(runtime?.arguments?.[0]).replayMarkerChecker).toBe(
        "replayMarkerChecker",
      );
    });

    it("carries the registry's own export seam rather than a rebuilt graph", () => {
      expect(calleeOf(propertyValue(populatedHandoff(), "capabilities"))).toBe(
        "registry.exportWorkerCapabilities",
      );
    });
  });
});
