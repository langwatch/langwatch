import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";

import {
  bumpedComponents,
  carriesBreakingChange,
  componentPins,
  releaseAsVersions,
  releaseComponents,
  shimPath,
  shimVersion,
} from "./guard-breaking-change-scope.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const scriptPath = resolve(
  import.meta.dirname,
  "guard-breaking-change-scope.ts",
);

const liveComponents = () =>
  releaseComponents(
    JSON.parse(
      readFileSync(
        resolve(repoRoot, ".github/release-please-config.json"),
        "utf8",
      ),
    ),
  );

const names = (files: string[]): string[] =>
  bumpedComponents(files, liveComponents())
    .map((component) => component.name)
    .sort();

const temporaryRoots: string[] = [];

after(() => {
  for (const root of temporaryRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A checkout shaped the way the workflow hands one to the guard: the live
 * release-please config and manifest, the shim contents at the pull request
 * head, and the two input files the collect step writes.
 */
const checkout = ({
  files,
  messages,
  shims = {},
}: {
  files: string[];
  messages: string[];
  shims?: Record<string, string>;
}): string => {
  const root = mkdtempSync(join(tmpdir(), "release-scope-guard-"));
  temporaryRoots.push(root);

  mkdirSync(join(root, ".github"));
  for (const file of [
    ".github/release-please-config.json",
    ".github/.release-please-manifest.json",
  ]) {
    copyFileSync(resolve(repoRoot, file), join(root, file));
  }
  for (const [path, content] of Object.entries(shims)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `${content}\n`);
  }

  writeFileSync(join(root, "changed-files.txt"), `${files.join("\n")}\n`);
  writeFileSync(
    join(root, "commit-messages.txt"),
    `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
  );
  return root;
};

const runGuard = (
  root: string,
): { status: number; stdout: string; stderr: string } => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      scriptPath,
      root,
      join(root, "changed-files.txt"),
      join(root, "commit-messages.txt"),
    ],
    { encoding: "utf8" },
  );
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

const shimSaying = (version: string): string =>
  `release-please shadow marker (v9), next: ${version}`;

const pinCommit = (component: string, version: string): string =>
  [
    `chore(release): pin ${component} at ${version}`,
    "",
    `Release-As: ${version}`,
  ].join("\n");

const breakingCommit = "feat(gateway)!: a key must say where its traces land";

/** One ordinary file per component, so three components come up bumped. */
const threeComponents = [
  "platform/app/src/server/gateway/spendFilters.ts",
  "sdks/python/src/langwatch/spend_events.py",
  "sdks/typescript/src/index.ts",
];

const rootShim = ".release-please-shim";
const pythonShim = "sdks/python/.release-please-shim";
const typescriptShim = "sdks/typescript/.release-please-shim";

describe("breaking-change scope guard", () => {
  describe("when reading the markers release-please reads", () => {
    it("finds the `!` marker in a header, scoped or not", () => {
      assert.equal(carriesBreakingChange(["feat!: drop the v1 endpoint"]), true);
      assert.equal(
        carriesBreakingChange(["feat(evaluators)!: remove the legacy ones"]),
        true,
      );
    });

    it("finds a header that arrives as a squash-body bullet", () => {
      assert.equal(
        carriesBreakingChange([
          "chore: merge branch\n\n* feat(evaluators)!: remove the legacy ones\n",
        ]),
        true,
      );
    });

    it("finds both spellings of the footer", () => {
      assert.equal(
        carriesBreakingChange(["feat: x\n\nBREAKING CHANGE: the v1 endpoint"]),
        true,
      );
      assert.equal(
        carriesBreakingChange(["feat: x\n\nBREAKING-CHANGE: the v1 endpoint"]),
        true,
      );
    });

    it("ignores prose that only talks about breaking changes", () => {
      assert.equal(
        carriesBreakingChange([
          "fix(api): keep the v1 endpoint alive\n\nThis is not a BREAKING CHANGE, the shim stays.",
        ]),
        false,
      );
      assert.equal(carriesBreakingChange(["feat(api): add a v2 endpoint"]), false);
    });

    it("ignores a release-please changelog that reports past breaks", () => {
      // A release PR restates every breaking change it ships. Reading it as a
      // marker would fail release-please's own pull requests, which touch the
      // manifest, the changelogs and the charts at once.
      assert.equal(
        carriesBreakingChange([
          [
            "chore(main): release langwatch 4.0.0",
            "",
            "### ⚠ BREAKING CHANGES",
            "",
            "* **evaluators:** evaluations referencing a legacy/ragas_* type stop working.",
            "",
            "### Features",
            "",
            "* **model-providers:** test a credential you have already saved",
          ].join("\n"),
        ]),
        false,
      );
    });
  });

  describe("when mapping changed files onto release components", () => {
    it("charges a file to its own package and not to a sibling", () => {
      assert.deepEqual(names(["sdks/typescript/src/index.ts"]), [
        "typescript-sdk",
      ]);
    });

    it("charges a nested package over the parent that contains it", () => {
      const components = releaseComponents({
        packages: {
          "sdks": { component: "sdks" },
          "sdks/typescript": { component: "typescript-sdk" },
        },
      });
      assert.deepEqual(
        bumpedComponents(["sdks/typescript/src/index.ts"], components).map(
          (component) => component.name,
        ),
        ["typescript-sdk"],
      );
    });

    it("charges a top-level file to the root package alone", () => {
      assert.deepEqual(names(["SECURITY.md"]), ["langwatch"]);
    });

    it("spares the root package when every file sits in an excluded path", () => {
      assert.deepEqual(names(["mcp/typescript/src/server.ts"]), ["mcp-server"]);
    });

    it("charges the root package when one file escapes the excluded paths", () => {
      // The shape of #6641: fifteen files under mcp/typescript, plus SECURITY.md.
      assert.deepEqual(
        names(["mcp/typescript/src/server.ts", "SECURITY.md"]),
        ["langwatch", "mcp-server"],
      );
    });

    it("reproduces the three components #6600 bumped at once", () => {
      assert.deepEqual(
        names([
          "sdks/typescript/src/cli/commands/evaluators/catalog.ts",
          "services/langevals/pyproject.toml",
          "platform/app/src/server/evaluations/evaluators.generated.ts",
        ]),
        ["langevals", "langwatch", "typescript-sdk"],
      );
    });

    it("spares a package whose every touched file is excluded", () => {
      const components = releaseComponents({
        packages: {
          "sdks/typescript": {
            component: "typescript-sdk",
            "exclude-paths": ["sdks/typescript/docs"],
          },
        },
      });
      assert.deepEqual(
        bumpedComponents(["sdks/typescript/docs/readme.md"], components),
        [],
      );
      assert.deepEqual(
        bumpedComponents(
          ["sdks/typescript/docs/readme.md", "sdks/typescript/src/index.ts"],
          components,
        ).map((component) => component.name),
        ["typescript-sdk"],
      );
    });
  });

  describe("when reading the release-please config", () => {
    it("keeps every configured package, named by its component", () => {
      const configured = liveComponents();
      const byPath = new Map(
        configured.map((component) => [component.path, component]),
      );
      assert.equal(byPath.get("sdks/typescript")?.name, "typescript-sdk");
      assert.equal(byPath.get(".")?.name, "langwatch");
      assert.ok(
        byPath.get(".")?.excludePaths.includes("sdks/typescript"),
        "the root package must keep excluding the typescript SDK",
      );
    });

    it("trims surrounding slashes the way release-please normalizes them", () => {
      const [component] = releaseComponents({
        packages: { ".": { component: "root", "exclude-paths": ["/skills/"] } },
      });
      assert.deepEqual(component?.excludePaths, ["skills"]);
    });
  });

  describe("when reading the two halves of a pin", () => {
    it("collects every `Release-As:` footer, and nothing that only reads like one", () => {
      assert.deepEqual(
        releaseAsVersions([
          "chore(release): pin the SDK\n\nRelease-As: 1.5.0",
          "chore(release): pin the product\n\nrelease-as: 3.11.0",
          "docs: explain that Release-As: beats every other signal",
          "feat: something else entirely",
        ]),
        ["1.5.0", "3.11.0"],
      );
    });

    it("reads the version out of every shim this repository ships", () => {
      for (const component of liveComponents()) {
        const shim = shimPath(component);
        const version = shimVersion(
          readFileSync(resolve(repoRoot, shim), "utf8"),
        );
        assert.match(
          version ?? "",
          /^\d+\.\d+\.\d+$/,
          `${shim} has to record a version the guard can match a footer to`,
        );
      }
    });

    it("takes a component as pinned only with the shim edit and the footer", () => {
      const [component] = releaseComponents({
        packages: { "sdks/typescript": { component: "typescript-sdk" } },
      });
      assert.ok(component);
      const pinFor = ({
        files,
        footerVersions,
      }: {
        files: string[];
        footerVersions: string[];
      }) =>
        componentPins({
          components: [component],
          files,
          footerVersions,
          readShim: () => shimSaying("1.5.0"),
        })[0];

      assert.equal(
        pinFor({ files: [typescriptShim], footerVersions: ["1.5.0"] })?.pinned,
        "1.5.0",
      );
      assert.equal(
        pinFor({ files: [typescriptShim], footerVersions: [] })?.pinned,
        undefined,
      );
      assert.equal(
        pinFor({ files: [typescriptShim], footerVersions: ["1.4.1"] })?.pinned,
        undefined,
      );
      assert.equal(
        pinFor({
          files: ["sdks/typescript/src/index.ts"],
          footerVersions: ["1.5.0"],
        })?.pinned,
        undefined,
      );
    });
  });

  describe("when the pull request pins the components it must not major", () => {
    /** @scenario "A pin does not exempt a component from the scope check" */
    it("refuses it even with every bumped component pinned", () => {
      const result = runGuard(
        checkout({
          files: [...threeComponents, rootShim, pythonShim, typescriptShim],
          messages: [
            breakingCommit,
            pinCommit("typescript-sdk", "1.5.0"),
            pinCommit("python-sdk", "1.2.1"),
            pinCommit("langwatch", "3.11.0"),
          ],
          shims: {
            [rootShim]: shimSaying("3.11.0"),
            [pythonShim]: shimSaying("1.2.1"),
            [typescriptShim]: shimSaying("1.5.0"),
          },
        }),
      );

      assert.equal(result.status, 1, result.stdout);
      assert.ok(
        result.stderr.includes("A pin does not exempt a component"),
        result.stderr,
      );
    });

    it("says a pin leaves the break in the pinned component's changelog", () => {
      const result = runGuard(
        checkout({
          files: [...threeComponents, pythonShim, typescriptShim],
          messages: [
            breakingCommit,
            pinCommit("typescript-sdk", "1.5.0"),
            pinCommit("python-sdk", "1.2.1"),
          ],
          shims: {
            [pythonShim]: shimSaying("1.2.1"),
            [typescriptShim]: shimSaying("1.5.0"),
          },
        }),
      );

      assert.equal(result.status, 1, result.stdout);
      assert.ok(
        result.stderr.includes("- typescript-sdk, pinned to 1.5.0"),
        result.stderr,
      );
      assert.ok(
        result.stderr.includes("- python-sdk, pinned to 1.2.1"),
        result.stderr,
      );
      assert.ok(
        result.stderr.includes(
          "still take the break into their own changelog",
        ),
        result.stderr,
      );
    });

    /** @scenario "A break spanning two components fails" */
    it("fails while more than one bumped component is still unpinned", () => {
      const result = runGuard(
        checkout({
          files: [...threeComponents, typescriptShim],
          messages: [breakingCommit, pinCommit("typescript-sdk", "1.5.0")],
          shims: { [typescriptShim]: shimSaying("1.5.0") },
        }),
      );

      assert.equal(result.status, 1);
      assert.ok(
        result.stderr.includes(
          "- typescript-sdk (sdks/typescript), now 1.4.0, pinned to 1.5.0",
        ),
        result.stderr,
      );
      assert.ok(result.stderr.includes("- python-sdk (sdks/python)"));
      assert.ok(result.stderr.includes("- langwatch (.)"));
    });

    it("fails naming the shim whose footer never arrived", () => {
      const result = runGuard(
        checkout({
          files: [...threeComponents, typescriptShim],
          messages: [breakingCommit],
          shims: { [typescriptShim]: shimSaying("1.5.0") },
        }),
      );

      assert.equal(result.status, 1);
      assert.ok(
        result.stderr.includes(`- ${typescriptShim} records next: 1.5.0,`),
        result.stderr,
      );
      assert.ok(
        result.stderr.includes("and no commit carries `Release-As: 1.5.0`."),
        result.stderr,
      );
    });

    it("fails naming the mismatch when the footer version drifted from the shim", () => {
      const result = runGuard(
        checkout({
          files: [...threeComponents, typescriptShim],
          messages: [breakingCommit, pinCommit("typescript-sdk", "1.4.1")],
          shims: { [typescriptShim]: shimSaying("1.5.0") },
        }),
      );

      assert.equal(result.status, 1);
      assert.ok(
        result.stderr.includes(`- ${typescriptShim} records next: 1.5.0,`),
        result.stderr,
      );
      assert.ok(
        result.stderr.includes("and no commit carries `Release-As: 1.5.0`."),
        result.stderr,
      );
      assert.ok(
        result.stderr.includes("Footers on this pull request: 1.4.1."),
        result.stderr,
      );
    });

    it("fails naming the shim that records no version to match", () => {
      const result = runGuard(
        checkout({
          files: [...threeComponents, typescriptShim],
          messages: [breakingCommit, pinCommit("typescript-sdk", "1.5.0")],
          shims: { [typescriptShim]: "release-please shadow marker (v9)" },
        }),
      );

      assert.equal(result.status, 1);
      assert.ok(
        result.stderr.includes(`- ${typescriptShim} changed but records no`),
        result.stderr,
      );
    });

    it("fails when a footer arrives with no shim edit to route it", () => {
      const result = runGuard(
        checkout({
          files: threeComponents,
          messages: [breakingCommit, pinCommit("typescript-sdk", "1.5.0")],
        }),
      );

      assert.equal(result.status, 1);
      assert.ok(
        result.stderr.includes("but changes no shim, so nothing routes them"),
        result.stderr,
      );
    });

    /** @scenario "A break confined to one component passes" */
    it("keeps a breaking change inside one component passing, pins or not", () => {
      const result = runGuard(
        checkout({
          files: ["sdks/typescript/src/index.ts"],
          messages: [breakingCommit],
        }),
      );

      assert.equal(result.status, 0, result.stderr);
      assert.ok(
        result.stdout.includes("breaking change scoped to typescript-sdk"),
        result.stdout,
      );
    });

    it("leaves the label override where it lives, ahead of the script", () => {
      const workflow = readFileSync(
        resolve(repoRoot, ".github/workflows/release-scope-guard.yml"),
        "utf8",
      );
      const label = workflow.indexOf(
        "contains(github.event.pull_request.labels.*.name, 'multi-component-major')",
      );
      const shortCircuit = workflow.indexOf(
        'if [ "$ACKNOWLEDGED" = "true" ]; then',
      );
      const guardRun = workflow.lastIndexOf(
        ".github/scripts/guard-breaking-change-scope.ts",
      );

      assert.ok(label > -1, "the label still reaches the job");
      assert.ok(
        shortCircuit > label && shortCircuit < guardRun,
        "the label still exits before the guard runs at all",
      );
      assert.ok(
        workflow.indexOf("exit 0", shortCircuit) < guardRun,
        "the label short circuit still exits 0",
      );
    });
  });

  describe("when replaying the pull request that motivated pin detection", () => {
    // #6656: a stacked branch that inherited a `!` commit from its base, bumped
    // three components, and pinned all three the way this guard's own
    // remediation says to. The file list and the commits are the ones the
    // workflow collects from the API, reduced to the messages that carry a
    // marker or a footer, and the shim contents are the ones at its head. The
    // guard failed it anyway, so the only unblock was the
    // `multi-component-major` label, which asserted three majors nobody wanted.
    const files = [
      ".github/workflows/gateway-matrix.yaml",
      ".release-please-shim",
      "docs/ai-gateway/api/errors.mdx",
      "docs/ai-gateway/billing-events.mdx",
      "docs/ai-gateway/cookbooks/metering-and-rebilling.mdx",
      "docs/api-reference/openapiLangWatch.json",
      "docs/llms-full.txt",
      "platform/app/src/app/api/gateway-spend/[[...route]]/app.ts",
      "platform/app/src/app/api/gateway-spend/[[...route]]/contract.ts",
      "platform/app/src/app/api/gateway-spend/__tests__/gateway-spend-rest-api.integration.test.ts",
      "platform/app/src/app/api/gateway-spend/__tests__/spendFilterParity.unit.test.ts",
      "platform/app/src/app/api/openapiLangWatch.json",
      "platform/app/src/features/errors/logic/codes.ts",
      "platform/app/src/features/errors/logic/presentation.ts",
      "platform/app/src/pages/settings/gateway/__tests__/billing-events.integration.test.tsx",
      "platform/app/src/pages/settings/gateway/billing-events.tsx",
      "platform/app/src/server/api/routers/__tests__/gatewaySpendEvents.unit.test.ts",
      "platform/app/src/server/api/routers/gatewaySpendEvents.ts",
      "platform/app/src/server/clickhouse/migrations/00076_gateway_spend_filter_indices.sql",
      "platform/app/src/server/gateway/__tests__/spendEventsCursor.unit.test.ts",
      "platform/app/src/server/gateway/__tests__/spendFiltering.integration.test.ts",
      "platform/app/src/server/gateway/__tests__/spendFilters.unit.test.ts",
      "platform/app/src/server/gateway/__tests__/spendGrouping.unit.test.ts",
      "platform/app/src/server/gateway/errors.ts",
      "platform/app/src/server/gateway/spendEvents.clickhouse.repository.ts",
      "platform/app/src/server/gateway/spendFilters.ts",
      "platform/app/src/server/gateway/spendGrouping.ts",
      "platform/app/src/server/gateway/spendScope.ts",
      "sdks/python/.release-please-shim",
      "sdks/python/src/langwatch/spend_events.py",
      "sdks/python/tests/test_webhooks_and_spend_facades.py",
      "sdks/typescript/.release-please-shim",
      "sdks/typescript/src/cli/commands/spend-events/summary.ts",
      "sdks/typescript/src/cli/program.ts",
      "sdks/typescript/src/client-sdk/services/spend-events/__tests__/spend-events-api.paging.unit.test.ts",
      "sdks/typescript/src/client-sdk/services/spend-events/spend-events-api.service.ts",
      "sdks/typescript/src/index.ts",
      "sdks/typescript/src/internal/generated/openapi/api-client.ts",
      "services/aigateway/adapters/gatewaymetrics/docs_contract_test.go",
      "specs/ai-gateway/gateway-spend-rest.feature",
    ];

    const shims = {
      ".release-please-shim": "release-please shadow marker (v5), next: 3.11.0",
      "sdks/python/.release-please-shim":
        "release-please shadow marker (v4), next: 1.2.1",
      "sdks/typescript/.release-please-shim":
        "release-please shadow marker (v6), next: 1.5.0",
    };

    const inheritedBreak =
      "feat(gateway)!: a key must say where its traces land, instead of having it guessed";

    const pins = [
      "chore(release): pin typescript-sdk at 1.5.0 under the inherited breaking marker\n\nRelease-As: 1.5.0",
      "chore(release): pin python-sdk at 1.2.1 under the inherited breaking marker\n\nRelease-As: 1.2.1",
      "chore(release): pin langwatch at 3.11.0 under the inherited breaking marker\n\nRelease-As: 3.11.0",
    ];

    // The workflow appends the pull request title, since a squash merge puts it
    // in the subject line.
    const title =
      "feat(spend): one filter vocabulary on both reads, and a grouping that refuses to lie";

    // Pin detection used to accept this. #4998 showed why that was wrong twice
    // over: three pin commits squash into one commit carrying three footers, of
    // which at most one can apply, and a pin that does apply still leaves the
    // break in that component's changelog. Splitting is the only thing that
    // scopes it, so this now fails and says so.
    it("refuses it, naming the pins that do not exempt it", () => {
      const result = runGuard(
        checkout({
          files,
          messages: [inheritedBreak, ...pins, title],
          shims,
        }),
      );

      assert.equal(result.status, 1, result.stdout);
      assert.ok(
        result.stderr.includes("A pin does not exempt a component"),
        result.stderr,
      );
      assert.ok(
        result.stderr.includes("- typescript-sdk, pinned to 1.5.0"),
        result.stderr,
      );
      assert.ok(
        result.stderr.includes("- python-sdk, pinned to 1.2.1"),
        result.stderr,
      );
      assert.ok(
        result.stderr.includes("- langwatch, pinned to 3.11.0"),
        result.stderr,
      );
    });

    it("still refuses it with the pin commits dropped, shims and all", () => {
      const result = runGuard(
        checkout({ files, messages: [inheritedBreak, title], shims }),
      );

      assert.equal(result.status, 1);
      for (const [shim, content] of Object.entries(shims)) {
        assert.ok(
          result.stderr.includes(
            `- ${shim} records next: ${shimVersion(content)},`,
          ),
          result.stderr,
        );
      }
    });
  });

  describe("when replaying the Go SDK break that majored the platform", () => {
    // #4998. Two breaking footers, both describing the Go SDK, on a pull
    // request that also carried ~1,700 lines of ordinary platform code. It
    // pinned the platform to 3.13.0 the documented way and the guard passed it.
    // Squash then merged seventeen commits into one whose body is all of theirs
    // concatenated, leaving two competing pins in a single 402-line message.
    // The platform pin did not apply: it went to 4.0.0 with the Go SDK's breaks
    // filed under its changelog, release PR #6787 stalled on that major, and
    // the #6842 Helm chart fix waited behind it.
    const files = [
      ".release-please-shim",
      "platform/app/src/server/app-layer/traces/canonicalisation/extractors/genAi.ts",
      "platform/app/src/server/event-sourcing/pipelines/trace-processing/reactors/trackedEventSync.reactor.ts",
      "sdks/go/instrumentation/openai/middleware.go",
      "specs/go-sdk/span-attribute-parity.feature",
    ];

    const messages = [
      "feat(sdk-go): native instrumentations, REST client, and gen_ai-first telemetry",
      "BREAKING CHANGE: the provider middlewares now capture input and output content by default",
      "chore(release): pin sdk-go at 1.0.0\n\nRelease-As: 1.0.0",
      "chore(release): pin langwatch at 3.13.0\n\nRelease-As: 3.13.0",
    ];

    /** @scenario "A Go SDK break never reaches the platform release" */
    it("refuses it, so the Go SDK break never reaches the platform release", () => {
      const result = runGuard(
        checkout({
          files,
          messages,
          shims: { ".release-please-shim": shimSaying("3.13.0") },
        }),
      );

      assert.equal(result.status, 1, result.stdout);
      assert.ok(
        result.stderr.includes("A pin does not exempt a component"),
        result.stderr,
      );
      assert.ok(
        result.stderr.includes("- langwatch, pinned to 3.13.0"),
        result.stderr,
      );
    });

    it("names both the platform and the Go SDK as reached by the break", () => {
      const result = runGuard(
        checkout({
          files,
          messages,
          shims: { ".release-please-shim": shimSaying("3.13.0") },
        }),
      );

      assert.ok(result.stderr.includes("- langwatch (.)"), result.stderr);
      assert.ok(result.stderr.includes("- sdks/go (sdks/go)"), result.stderr);
    });

    it("passes once the break touches sdks/go alone", () => {
      const result = runGuard(
        checkout({
          files: files.filter((file) => file.startsWith("sdks/go/")),
          messages,
        }),
      );

      assert.equal(result.status, 0, result.stderr);
      assert.ok(
        result.stdout.includes("breaking change scoped to sdks/go"),
        result.stdout,
      );
    });

    // specs/ is not among the root package's exclude-paths, so the feature file
    // that documents the Go SDK's own behaviour is enough on its own to charge
    // the platform and put it back in scope. Worth knowing before splitting:
    // the spec has to travel in the non-breaking pull request.
    /** @scenario "One incidental file is enough to widen the scope" */
    it("still refuses it when only the spec file rides along", () => {
      const result = runGuard(
        checkout({
          files: files.filter(
            (file) =>
              file.startsWith("sdks/go/") || file.startsWith("specs/go-sdk/"),
          ),
          messages,
        }),
      );

      assert.equal(result.status, 1, result.stdout);
      assert.ok(result.stderr.includes("- langwatch (.)"), result.stderr);
    });
  });
});
