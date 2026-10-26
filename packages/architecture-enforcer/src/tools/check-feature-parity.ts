#!/usr/bin/env -S node --experimental-transform-types
/**
 * Feature-parity check: every `@integration` / `@unit` scenario in every
 * `.feature` file under a configured specification root must be bound to at
 * least one test via a `@scenario "<title>"` JSDoc annotation.
 *
 * Enforces the "Feature File Parity" rule from
 * dev/docs/TESTING_PHILOSOPHY.md. Without this check, feature files can drift
 * into documentation that nobody verifies.
 *
 * Polarity: enforce-all by default, and fail closed. The migration debt is
 * carried by lists that only ever shrink:
 *
 *   - `LEGACY_UNBOUND` — files with enforced-but-unbound scenarios.
 *   - `feature-parity-frozen.json` — the exact `(file, scenario title)` pairs
 *     that were untagged, or `@unimplemented` without a tracked issue, when
 *     tolerance moved from files to scenarios. Any other untagged scenario
 *     fails, and so does a listed pair that has since been fixed. A file whose
 *     scenarios are all untagged would otherwise report `0/0 scenarios bound ·
 *     ✓ all bound` and pass, an assertion of coverage that does not exist.
 *
 * It also fails an `@scenario` annotation whose scenario carries no binding
 * tag: the test looks bound while the gate measures nothing.
 *
 * Shrinking the lists toward zero is the work tracked by #3338.
 *
 * Usage:
 *   pnpm check:feature-parity              # exit 1 if any enforced unbound
 *   pnpm check:feature-parity --json       # machine-readable report
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Walks up from this file until `pnpm-workspace.yaml` turns up — the one
 * file every worktree has exactly once, at the root. Unlike a fixed
 * `../..` count, this doesn't break when the tool moves.
 */
function findRepoRoot(from: string): string {
  let directory = from;

  for (;;) {
    const marker = join(directory, "pnpm-workspace.yaml");
    if (existsSync(marker)) return directory;

    const parent = dirname(directory);

    if (parent === directory) {
      throw new Error(
        `pnpm-workspace.yaml not found above ${from}; is this inside the repository?`,
      );
    }

    directory = parent;
  }
}

const REPO_ROOT = findRepoRoot(__dirname);

/**
 * Every tree that holds `.feature` files. Package-owned specifications are listed explicitly
 * for the same reason as the SDK tree: a package boundary must not make its behavioural
 * contracts invisible to the repository-wide parity gate.
 */
function discoverPackageSpecRoots(packagesRoot: string): string[] {
  if (!existsSync(packagesRoot)) return [];

  const roots: string[] = [];

  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;

      const path = join(directory, entry.name);

      if (entry.name === "specs") {
        roots.push(path);
      } else {
        visit(path);
      }
    }
  };

  visit(packagesRoot);

  return roots.toSorted();
}

const SPECS_ROOTS = [
  resolve(REPO_ROOT, "specs"),
  ...discoverPackageSpecRoots(resolve(REPO_ROOT, "packages")),
  ...discoverPackageSpecRoots(resolve(REPO_ROOT, "modules")),
  ...discoverPackageSpecRoots(resolve(REPO_ROOT, "enterprise")),
  resolve(REPO_ROOT, "sdks/typescript/specs"),
] as const;

/**
 * Test roots scanned for `@scenario` bindings. Every `.test.ts`, `.spec.ts` /
 * `.test.tsx` file under these roots is parsed for annotations. A binding
 * matches by scenario title, so proximity of the feature file to the test
 * is not required — any test in these roots can bind any scenario.
 */
const DEFAULT_TEST_ROOTS: string[] = [
  // The Langy dogfood scenario suite (apps/ui/e2e/langy) runs against a live
  // stack, so it is not in any CI vitest lane — but its scenario tests are
  // still the binding surface for @e2e-tagged specs about Langy's
  // conversational behavior. Without this root those specs could only be
  // @unimplemented. It is reached through the "apps" root below.
  "packages",
  // The module trees: every module's own suite, core and Enterprise alike.
  "modules",
  "enterprise",
  // The process compositions (apps/api, apps/ui, apps/worker, apps/server). Code moving out of
  // the platform application took its tests with it — the worker's liveness/metrics server is
  // the first — and without this root every scenario those tests bind would silently become
  // unbound the moment the code left, which reads as "the spec was never enforced" rather than
  // as a move.
  "apps",
  // Langy's pi-harness wrapper: the process that turns the manager's config
  // into pi's model registry and speaks the stdio protocol. Scenarios about
  // what the wrapper generates can only bind from its own vitest suite.
  "services/langyworker/src",
  "mcp/typescript/src",
  "sdks/typescript/src",
  "sdks/typescript/__tests__",
  "sdks/python/src",
  // The identity front-door e2e pass runs against a live app with no other
  // suite behind it — a Playwright ceremony against a real virtual WebAuthn
  // authenticator and a real Postgres-backed verification token is the only
  // place several of these scenarios are proven end-to-end. Without this
  // root their `@scenario` bindings would be invisible to the checker even
  // though the tests exist and run in `e2e-ci.yml`.
  "dev/tests",
  // The agent plugin is hand-authored manifests plus a bundle, so its only
  // tests are the ones that read those manifests and spawn that bundle. Without
  // this root, every scenario describing what the published plugin does could
  // only be @unimplemented.
  "plugins",
  // The seed runner's tests bind specs/setup/seedgen-runner.feature.
  "tools/seedgen/runner/src",
  // The contributor-only backend launcher (tools/dev-runtime): the API and the
  // worker in one local process. Its boot order and its shutdown ordering —
  // drain the worker, then close the API listener — are asserted by its own
  // vitest suite and by nothing else.
  "tools/dev-runtime/src",
  // What we SHIP as instructions is behavior too: the skill sources and the
  // assistant's rules are tested here (and nowhere else), so scenarios about
  // what an instruction teaches can only bind from this root.
  "skills/_tests",
  // CI guards run under `node --test` from the workflow that uses them, not
  // vitest, and their tests live beside them. Without this root, a scenario
  // describing what a guard refuses could only ever be @unimplemented.
  ".github/scripts",
  // dev/scripts' own JS/TS logic is tested with `node --test`, not vitest,
  // and lives beside the scripts it tests — DEFAULT_BATS_TEST_ROOTS already
  // scans this directory for `.bats` files; this is the `.test.mjs`
  // counterpart. Without it, dev-tooling scenarios could only ever be @unimplemented.
  "dev/scripts/__tests__",
  // dev/nx plugins' own logic is tested with `node --test` beside them.
  "dev/nx/__tests__",
  "dev/scripts/upgrade-rehearsal/__tests__",
];

/**
 * Roots scanned for `.bats` shell tests. Shell-driven dev-environment
 * behavior (compose overrides, worktree setup) is tested with
 * bats, not vitest — without this scan path, scenarios that describe
 * shell behavior would have no way to satisfy parity and would be stuck
 * on `@unimplemented` forever. Bats bindings use the same `@scenario`
 * token, expressed as a hash-comment above an `@test "..." {` line —
 * blank lines and further comments may sit between the two.
 */
const DEFAULT_BATS_TEST_ROOTS: string[] = ["dev/scripts/__tests__"];

/**
 * Roots scanned for `.sh` shell tests. Helm chart behaviour is verified by
 * rendering the chart, which needs helm and its built dependencies, so those
 * suites live beside the chart and run in the chart workflow rather than under
 * vitest or bats. Without this scan path their scenarios could only be
 * @unimplemented or bound to assertions on template *text* — and asserting
 * that a template contains `ceil` passes just as happily when it says `floor`,
 * which is the vacuous check rendering exists to replace.
 *
 * Bindings use the same `@scenario` token as bats, expressed as a
 * hash-comment above a `test_<name>() {` function — blank lines and further
 * comments may sit between the two.
 */
const DEFAULT_SHELL_TEST_ROOTS: string[] = [
  // CI's own shell steps. The secrets gate is scoped by a shell script and
  // proved correct by running the real scanners against fixture repositories,
  // which is neither a vitest nor a bats suite — without this root, scenarios
  // about which commits a blocking gate examines could only be @unimplemented.
  ".github/scripts/__tests__",
  "charts/langwatch/tests",
  // The gateway subchart carries its own drain-timing suite, run by the
  // `helm` job in go-services.yaml rather than by the umbrella chart's
  // workflow, because that job is what the gateway chart's path filter
  // already triggers.
  "charts/gateway/tests",
  // ClickHouse serverless Helm sub-chart rendering tests, verifying that
  // keeper-backed access storage configuration is correctly rendered at all
  // replica counts through template assertions in e2e.sh and e2e-overlays.sh.
  "charts/clickhouse-serverless/tests",
];

/**
 * Roots scanned for Go `_test.go` files. Go-side scenarios use the same
 * `@scenario` token as TS, but the proximity check looks for a
 * `func TestXxx(t *testing.T) {` line instead of `it(` / `test(`. Without
 * this scan path, scenarios pinned to Go integration tests under
 * `services/nlpgo/` would have no way to satisfy parity and would either
 * require @unimplemented forever or a fake TS skip-stub.
 */
const DEFAULT_GO_TEST_ROOTS: string[] = [
  "services/nlpgo",
  "services/aigateway",
  // The Langy worker manager. Its specs (egress enforcement, worker isolation,
  // shutdown handoff) are satisfied by Go tests and by nothing else, so without
  // this root those scenarios could only ever be @unimplemented or bound to a
  // TS stub that proves nothing.
  "services/langyagent",
  // The IdP simulator. Its scenarios (OIDC/SAML/SCIM/domain verification,
  // specs/setup/idp-simulator.feature) are satisfied by Go tests and by
  // nothing else.
  "services/sims/idpsim",
  // The mail sink. Its service-side scenarios (SMTP intake, the message API,
  // security headers, the browser inbox — specs/setup/mail-sink.feature) are
  // satisfied by Go tests and by nothing else.
  "services/sims/mailsim",
  // The other simulators haven runs (LLM, storage, analytics, voice, outbound,
  // telemetry) and the fuzz and worker suites: their specs/setup scenarios bind
  // only from Go tests.
  "services/sims/llmsim",
  "services/sims/storagesim",
  "services/sims/analyticssim",
  "services/sims/voicesim",
  "services/sims/outboundsim",
  "services/sims/paymentsim",
  "services/sims/telemetrysim",
  "services/sims/lambdasim",
  "services/sims/githubsim",
  "services/sims/mcpsim",
  // The Go scenario runner: its child-contract and fence scenarios bind only from Go tests.
  "services/scenariorunner",
  "tools/workerrun",
  "tools/seedgen",
  // The Go SDK. Its span-attribute scenarios (typed input/output envelopes,
  // binary content parts, metadata hoisting, data capture) are satisfied by Go
  // tests and by nothing else, so without this root those scenarios could only
  // ever be @unimplemented or bound to a TS test that exercises a different
  // SDK — a binding that reads green while proving nothing about Go.
  "sdks/go",
  "pkg",
  "tools/thuishaven",
  "tools/herrgen",
  // CI's own behaviour is behaviour too — how a job checks out, which
  // toolchain it compiles with. The ciguard tests are the only thing that
  // asserts it, so scenarios under specs/ci/ can only bind from this root.
  // Without it those feature files report "all bound" while binding nothing.
  "tools/ciguard",
  "tools/migrationorder",
  // The README link checker, for the same reason: specs/ci/readme-link-check.feature
  // describes what CI asserts about the README, and only these Go tests assert it.
  "tools/linkcheck",
  // The CLI half of the same tool: the verdict-to-exit-code step is the part
  // CI gates on, so the "check fails" / "check passes" scenarios bind here.
  "cmd/linkcheck",
  // The mono-binary's own dispatch, including the combined Go development
  // process (`service combined`). Which services it hosts, what telemetry
  // identity each keeps and which address variable each binds are asserted
  // here and nowhere else.
  "cmd/service",
  // upgradelab: snapshot format, restore guards, scrub and generation (specs/upgrade/*.feature)
  // are asserted by these Go tests only.
  "tools/upgradelab",
  // telemetrysim: presets, rates, fuzz replay and its control API
  // (specs/setup/haven-telemetrysim.feature) are asserted by these Go tests only.
  "services/sims/telemetrysim",
  // ClickHouse serverless chart configuration rendering. Scenarios describing
  // keeper-backed replicated access storage binding through unit tests in
  // internal/render/render_test.go that verify the XML config is generated
  // correctly across topology transitions.
  "infra/clickhouse-serverless",
];

/**
 * Roots scanned for Python `test_*.py` files. Python-side scenarios
 * (langevals scorers) use the same `@scenario` token as TS/Go; binding
 * is satisfied when the next non-blank, non-comment line is a
 * `def test_...` function. Without this scan path, scenarios pinned to
 * langevals scorers would have no way to satisfy parity short of a
 * misleading TS stub.
 */
const DEFAULT_PYTHON_TEST_ROOTS: string[] = ["services/langevals", "sdks/python"];

/**
 * Feature files whose unbound `@unit` / `@integration` scenarios are tolerated (non-fatal)
 * during migration. These files still parse; their counts surface in the `legacy` block of
 * `--json` output and in the human-readable summary so shrinkage is visible.
 */
const LEGACY_UNBOUND: string[] = [
  // sdks/typescript/specs is absent from THIS list, but do not read that as
  // "the tree is fully resolved" — it is not. Adding the tree to SPECS_ROOTS
  // made it discoverable, and every scenario in it that carries a `@unit` /
  // `@integration` tag is bound. Most of its scenarios carry no tag at all and
  // so are invisible to this gate: `sdks/typescript/specs/cli/daemon.feature`,
  // for one, has 35 scenarios of which 2 are enforced and none are
  // @unimplemented. Its untagged scenarios are frozen by title in
  // feature-parity-frozen.json; tagging the remainder is still outstanding.
  //
  // The consolidated Langy/home corpus landed while feature parity was already
  // enforce-all, but its tests predate @scenario bindings. Keep the debt
  // explicit and file-scoped while #3338 drives this list back to empty; new
  // feature files remain enforced by default.
  "specs/home/home-views.feature",
  "specs/langy/langy-api-key-provisioning.feature",
  "specs/langy/langy-capability-cards.feature",
  "specs/langy/langy-cli-tool-envelope.feature",
  "specs/langy/langy-context-system.feature",
  "specs/langy/langy-dual-stream.feature",
  "specs/langy/langy-feedback.feature",
  "specs/langy/langy-followup-suggestions.feature",
  "specs/langy/langy-frontend-realtime.feature",
  "specs/langy/langy-github-prs.feature",
  "specs/langy/langy-projection-independent-reactions.feature",
];

/**
 * The scenarios the gate tolerates, one exact `(feature file, scenario title)`
 * pair at a time. Both lists only ever shrink: a scenario that is not listed and
 * breaks the rule fails the run, and a listed one that no longer breaks it (it
 * was tagged, given an issue, renamed or deleted) fails the run until its entry
 * is removed. Tolerance used to be granted per file, which let a new untagged
 * scenario in a listed file pass unseen.
 *
 *   - `untagged`: scenarios carrying neither a binding tag nor `@unimplemented`.
 *   - `unimplementedWithoutIssue`: `@unimplemented` scenarios that cite no
 *     tracked issue (see `ISSUE_TAG_RE`).
 *   - `annotatedUntagged`: `@scenario` annotations, keyed by the test file that
 *     carries them, whose scenario carries no binding tag.
 */
const FROZEN_SCENARIOS_FILE = join(__dirname, "feature-parity-frozen.json");
const FROZEN_SCENARIOS_RELATIVE =
  "packages/architecture-enforcer/src/tools/feature-parity-frozen.json";

export interface FrozenScenarios {
  untagged: Record<string, string[]>;
  unimplementedWithoutIssue: Record<string, string[]>;
  annotatedUntagged: Record<string, string[]>;
}

function loadFrozenScenarios(): FrozenScenarios {
  const parsed = JSON.parse(
    readFileSync(FROZEN_SCENARIOS_FILE, "utf8"),
  ) as Partial<FrozenScenarios>;

  return {
    untagged: parsed.untagged ?? {},
    unimplementedWithoutIssue: parsed.unimplementedWithoutIssue ?? {},
    annotatedUntagged: parsed.annotatedUntagged ?? {},
  };
}

const TEST_FILE_RE = /\.(?:test|spec)\.(?:tsx?|mjs)$/;
const BATS_FILE_RE = /\.bats$/;
const SHELL_TEST_FILE_RE = /\.sh$/;
const GO_TEST_FILE_RE = /_test\.go$/;
const PYTHON_TEST_FILE_RE = /^test_.+\.py$/;
const FEATURE_FILE_RE = /\.feature$/;
const SKIP_DIR = new Set(["node_modules", ".next", "dist", "build"]);

const BOUND_TAGS = new Set(["@unit", "@integration", "@e2e", "@regression"]);

/**
 * Scenarios tagged `@unimplemented` have no expected test and are filtered
 * out of bound/unbound counting — they represent tracked gaps, not binding
 * failures. See dev/docs/TESTING_PHILOSOPHY.md.
 */
const UNIMPLEMENTED_TAG = "@unimplemented";

/**
 * How an `@unimplemented` scenario names its tracking issue: an `@issue:1234` (or `@issue-1234`)
 * tag on it or its feature, or a `#1234` / `.../issues/1234` reference in the comment lines
 * directly above its tags. A blank line ends "directly above".
 */
const ISSUE_TAG_RE = /^@issue[:-]\d+$/;
const ISSUE_REFERENCE_RE = /(?:^|[^\w&])#\d+\b|\/issues\/\d+\b/;

interface Scenario {
  title: string;
  tags: string[];
  line: number;
  /** Whether an issue is cited for it, by tag or by the comment directly above. */
  citesIssue?: boolean;
}

/** A scenario named by where it lives, for the frozen lists and their verdicts. */
export interface ScenarioRef {
  feature: string;
  title: string;
  line?: number;
}

interface BindingRef {
  file: string;
  line: number;
}

interface AnnotatedScenario extends Scenario {
  bindings: BindingRef[];
}

interface Report {
  feature: string;
  scenarios: AnnotatedScenario[];
  unbound: Scenario[];
  /** Every scenario the file declares, tagged or not. */
  totalScenarios: number;
  /** Of those, how many are explicitly parked as `@unimplemented`. */
  unimplementedScenarios: number;
  /**
   * Neither a lane tag nor `@unimplemented` — unmeasured and invisible to
   * the bound count. Each one fails the run unless `untagged` in the frozen
   * list names it.
   */
  untaggedScenarios: number;
  untagged: Scenario[];
  /** `@unimplemented` scenarios that cite no tracked issue. */
  unimplementedWithoutIssue: Scenario[];
}

/** A feature file that declares scenarios but no ENFORCED ones. */
interface InertReport {
  feature: string;
  totalScenarios: number;
  /** Of those, how many are explicitly parked as `@unimplemented`. */
  unimplemented: number;
}

interface LegacyReport {
  feature: string;
  bound: number;
  unbound: number;
  total: number;
  unboundTitles: string[];
}

interface UnknownAnnotation {
  title: string;
  ref: BindingRef;
}

export interface CollectedBinding {
  title: string;
  ref: BindingRef;
}

const GHERKIN_BODY_PREFIXES = ["Given", "When", "Then", "And", "But", "|"] as const;

function parseFeature(absPath: string): Scenario[] {
  return parseFeatureSource(readFileSync(absPath, "utf8"));
}

export function parseFeatureSource(raw: string): Scenario[] {
  const lines = raw.split("\n");
  const scenarios: Scenario[] = [];
  // Tags preceding the `Feature:` line apply to every scenario in the file
  // per Gherkin semantics (feature-level tagging).
  let featureTags: string[] = [];
  let featureSeen = false;
  let pendingTags: string[] = [];
  // The comment lines directly above the next scenario, read for an issue reference.
  let pendingComments: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed === "") {
      pendingComments = [];
      continue;
    }

    if (trimmed.startsWith("#")) {
      pendingComments.push(trimmed);
      continue;
    }

    if (trimmed.startsWith("@")) {
      const lineTags = trimmed.split(/\s+/).filter((t) => t.startsWith("@"));
      pendingTags = pendingTags.concat(lineTags);
      continue;
    }

    if (!featureSeen && trimmed.startsWith("Feature:")) {
      featureTags = pendingTags;
      pendingTags = [];
      pendingComments = [];
      featureSeen = true;
      continue;
    }

    const scenarioMatch = trimmed.match(/^Scenario(?:\s+Outline)?:\s*(.+)$/);

    if (scenarioMatch) {
      const tags = [...featureTags, ...pendingTags];

      scenarios.push({
        title: scenarioMatch[1]!.trim(),
        tags,
        line: i + 1,
        citesIssue:
          tags.some((t) => ISSUE_TAG_RE.test(t)) ||
          pendingComments.some((c) => ISSUE_REFERENCE_RE.test(c)),
      });

      pendingTags = [];
      pendingComments = [];
      continue;
    }

    pendingComments = [];
    // A step or table row keeps the pending tags; anything else drops them.
    if (!GHERKIN_BODY_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) pendingTags = [];
  }

  return scenarios;
}

function walkFiles(root: string, predicate: (name: string) => boolean): string[] {
  const out: string[] = [];
  let entries: string[];

  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (SKIP_DIR.has(entry)) continue;

    if (entry.startsWith(".")) continue;

    const full = join(root, entry);
    let s;

    try {
      s = statSync(full);
    } catch {
      continue;
    }

    if (s.isDirectory()) {
      out.push(...walkFiles(full, predicate));
    } else if (predicate(entry)) {
      out.push(full);
    }
  }

  return out;
}

/**
 * A configured root that is missing is a CONFIGURATION failure, not an empty tree. Skipping it
 * silently is how a renamed or moved spec directory reports every scenario in it as bound: the
 * files simply stop being discovered, and the check goes green having measured nothing.
 */
export function discoverFeatureFiles(roots: readonly string[] = SPECS_ROOTS): string[] {
  const files = roots.flatMap((root) => {
    if (!existsSync(root)) {
      throw new Error(
        `Configured specs root does not exist: ${root}. ` +
          `Fix SPECS_ROOTS in scripts/check-feature-parity.ts, or restore the tree — ` +
          `a missing root would silently report every scenario under it as bound.`,
      );
    }

    const rootStat = statSync(root);

    if (!rootStat.isDirectory()) {
      throw new Error(
        `Configured specs root is not a directory: ${root}. ` +
          `Fix SPECS_ROOTS in scripts/check-feature-parity.ts.`,
      );
    }

    return walkFiles(root, (n) => FEATURE_FILE_RE.test(n));
  });

  return files.map((f) => relative(REPO_ROOT, f)).toSorted();
}

// Non-backtracking: find `@scenario <title>` tokens, then verify proximity
// to an `it(` / `test(` call with a linear forward scan (see
// `isFollowedByTestCall`). Doing it all in the regex invites ReDoS.
//
// The token has to open its comment, or, when it opens no comment of its own,
// be inside one already: `markerlessBindingSpans` below decides that case. The
// unquoted alternative accepts a bare title; without anchor, any sentence containing the
// word binds to whatever follows it. The prefix allows markers actually used in repo.
//
// Each marker there is a fixed two characters or one, never `/*+`. A variable
// repeat inside the alternation makes `/**` splittable both as one `/*+` and
// as `/*` then `*`, which gives a line of `/**/**/...` exponentially many
// parses: measured at 6.8s for thirty repetitions, against every source file
// in the repo on every run. Spelled this way each marker is consumed exactly
// once, so there is nothing to backtrack over, and the accepted set is the
// same because `/**` is just `/*` followed by one more iteration.
const ANNOTATION_RE =
  /^[ \t]*(?:(?:\/\/|\/\*|\*|#)[ \t]*)*@scenario[ \t]+(?:"([^"\n]+)"|'([^'\n]+)'|([^\n*]+?))[ \t]*(?:\*\/|$)/gm;

/**
 * The spans of `src` that a MARKER-LESS annotation is allowed to live in: block comments, and
 * the triple-quoted strings Python writes its docstrings as. WHY THIS EXISTS.
 */
/** The offset just past `close` after `from`, or the end of `src`. */
function spanEnd(src: string, from: number, close: string): number {
  const at = src.indexOf(close, from);

  return at === -1 ? src.length : at + close.length;
}

/** The end of the block comment opening at `i`, or null if none opens there. */
function blockCommentAt(src: string, i: number): number | null {
  return src[i] === "/" && src[i + 1] === "*" ? spanEnd(src, i + 2, "*/") : null;
}

/** The end of the triple-quoted string opening at `i`, or null if none does. */
function tripleQuoteAt(src: string, i: number): number | null {
  const ch = src[i];
  if (ch !== '"' && ch !== "'") return null;

  const quote = ch.repeat(3);

  return src.startsWith(quote, i) ? spanEnd(src, i + 3, quote) : null;
}

function markerlessBindingSpans(src: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];

  for (let i = 0; i < src.length;) {
    const end = blockCommentAt(src, i) ?? tripleQuoteAt(src, i);

    if (end === null) {
      i++;
      continue;
    }

    spans.push({ start: i, end });
    i = end;
  }

  return spans;
}

/** Whether the annotation opened its own comment, which needs no further proof. */
const MARKED_ANNOTATION = /^[ \t]*(?:\/\/|\/\*|\*|#)/;

/**
 * Every `@scenario` annotation in `src`, with the offset just past each match so
 * callers can run their own proximity check.
 *
 * Exported because this is where the "the token has to open its comment" rule
 * lives, and that rule is easy to get wrong in both directions: too loose and
 * prose binds, too tight and the hash-comment form used by Python tests stops
 * binding. Three collectors shared this loop verbatim before; they now share it
 * for real, so the rule cannot drift between languages.
 */
export function findScenarioAnnotations(
  src: string,
): { title: string; index: number; end: number }[] {
  const found: { title: string; index: number; end: number }[] = [];
  let spans: { start: number; end: number }[] | null = null;

  ANNOTATION_RE.lastIndex = 0;

  for (let m = ANNOTATION_RE.exec(src); m !== null; m = ANNOTATION_RE.exec(src)) {
    const title = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!title) continue;

    if (!MARKED_ANNOTATION.test(m[0])) {
      // Computed on first need: most files have no marker-less annotation at
      // all, and this walks the whole source.
      spans ??= markerlessBindingSpans(src);
      // The match starts at the line's indentation, so the token's own offset
      // is what has to be inside the span.
      const at = m.index + m[0].indexOf("@scenario");
      if (!spans.some((span) => at >= span.start && at < span.end)) continue;
    }

    found.push({ title, index: m.index, end: m.index + m[0].length });
  }

  return found;
}

/**
 * The index past the comment text at `at`: a fresh comment, or the rest of a
 * JSDoc block the annotation sat inside (` *` lines and the ` *\/` closer).
 * `at` itself when no comment is there, -1 when one never ends.
 */
function pastTsComment({ src, at }: { src: string; at: number }): number {
  const ch = src[at];
  const next = src[at + 1];
  if (ch === "*" && next === "/") return at + 2;
  if (ch === "*" || (ch === "/" && next === "/")) {
    const nl = src.indexOf("\n", at);
    return nl === -1 ? -1 : nl + 1;
  }
  if (ch === "/" && next === "*") {
    const close = src.indexOf("*/", at + 2);
    return close === -1 ? -1 : close + 2;
  }
  return at;
}

/**
 * Whether a test call follows `start` — the proximity half of a binding. Oxlint's `RuleTester`
 * (`tests/*.test.mjs`) registers its cases through `tester.run(name, rule, { valid, invalid
 * })`, with `RuleTester.it = it` underneath, so that call is the test call for a fixture suite.
 */
export function isFollowedByTestCall(src: string, start: number): boolean {
  const len = src.length;
  let i = start;

  while (i < len) {
    const ch = src[i];

    if (SOURCE_WHITESPACE.has(ch ?? "")) {
      i++;
      continue;
    }

    const next = pastTsComment({ src, at: i });
    if (next === -1) return false;
    if (next !== i) {
      i = next;
      continue;
    }

    const rest = src.slice(i);
    // Vitest's typed table form is still a test call: `it.each<T>([...])`. Keep the type argument
    // narrow and line-local so proximity remains a lexical check rather than attempting to parse
    // arbitrary TypeScript. `void it(...)` is the same call, and is how every `node --test` suite
    // writes it; without the prefix all 34 `.github/scripts` scenarios bound nothing while reading
    // as bound.

    const m = rest.match(
      /^(?:(?:void|await)\s+)?(?:it|test|tester\.run)(?:\.[a-zA-Z]+)?(?:<[^>\n]+>)?\s*\(/,
    );

    return m !== null;
  }

  return false;
}

function collectAllBindings(testRoots: string[]): CollectedBinding[] {
  const bindings: CollectedBinding[] = [];
  const files: string[] = [];

  for (const r of testRoots) {
    files.push(...walkFiles(resolve(REPO_ROOT, r), (n) => TEST_FILE_RE.test(n)));
  }

  for (const file of files) {
    const src = readFileSync(file, "utf8");

    for (const a of findScenarioAnnotations(src)) {
      if (!isFollowedByTestCall(src, a.end)) continue;

      const line = src.slice(0, a.index).split("\n").length;

      bindings.push({
        title: a.title,
        ref: { file: relative(REPO_ROOT, file), line },
      });
    }
  }

  return bindings;
}

/**
 * Bats binding form (line-oriented, comment-prefixed):
 *
 *   # @scenario "all-local overrides only DATABASE_URL, REDIS_URL, CLICKHOUSE_URL"
 *   @test "all-local rewrites DATABASE_URL, REDIS_URL, CLICKHOUSE_URL only" {
 *     ...
 *   }
 *
 * Title may be wrapped in `"..."` or `'...'`. The next non-blank,
 * non-comment line must begin with `@test ` (case-insensitive on `@test`
 * to mirror bats' own tolerance). Bare-word titles aren't supported here
 * because bash line-comments make it ambiguous where the title ends.
 */
// CRLF tolerance: `\r` is included in the trailing-whitespace class so files
// committed with Windows line endings still match. The capture groups also
// exclude `\r` so the title doesn't pick up a trailing CR.
const BATS_ANNOTATION_RE = /^[ \t]*#[ \t]*@scenario[ \t]+(?:"([^"\r\n]+)"|'([^'\r\n]+)')[ \t\r]*$/;

function isNextLineBatsTest(lines: string[], startLineIdx: number): boolean {
  for (let i = startLineIdx; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed === "") continue;

    if (trimmed.startsWith("#")) continue;

    return /^@test\b/.test(trimmed);
  }

  return false;
}

/**
 * Shell binding form. Mirrors the bats rule, with a shell function standing in
 * for `@test`, so an annotation still has to introduce the thing that runs —
 * the next line that is neither blank nor a comment must be the function:
 *
 *   # @scenario "A fractional allowance rounds up to a whole worker"
 *   test_fractional_allowance_rounds_up() {
 *
 * The `test_` prefix is required: it keeps a stray annotation above a helper
 * from counting as a binding.
 */
function isNextLineShellTest(lines: string[], startLineIdx: number): boolean {
  for (let i = startLineIdx; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed === "") continue;

    if (trimmed.startsWith("#")) continue;

    return /^test_[A-Za-z0-9_]*[ \t]*\([ \t]*\)[ \t]*\{/.test(trimmed);
  }

  return false;
}

/**
 * Go binding form (block-comment, matches the TS form byte-for-byte):
 *
 *   /\*\* @scenario "PromptApiService.get sibling carries the combined handle:version id" *\/
 *   func TestPromptSpansExecuteComponent_GetSiblingCarriesCombinedId(t *testing.T) {
 *     t.Skip(promptSpansPendingMsg)
 *   }
 *
 * Table-driven Go tests bind at SUBTEST granularity, which is where the
 * behaviour actually lives — a top-level `func TestX` that hosts a dozen
 * `t.Run` cases would otherwise force every scenario in the group onto one
 * annotation. So a `t.Run("...", func(t *testing.T) {` line is an equally
 * valid binding site:
 *
 *   // @scenario "Every span of a turn names the model the same way"
 *   t.Run("substitutes the manager-held model id on model-call spans", func(t *testing.T) {
 *
 * Same ANNOTATION_RE that handles TS — only the proximity check differs:
 * we require the next non-blank, non-comment token to be `func Test...` or
 * a `t.Run(...)` subtest declaration.
 */
const GO_TEST_FUNC_RE =
  /^func\s+Test[A-Za-z0-9_]*\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s+\*testing\.T\s*\)/;

/** Opening of a subtest call: `t.Run(` / `subT.Run(` / … */
const GO_SUBTEST_HEAD_RE = /^[A-Za-z_][A-Za-z0-9_]*\.Run\(/;

/** What makes a `.Run(...)` call a SUBTEST: the `func(t *testing.T) {` closure. */
const GO_SUBTEST_CLOSURE_RE = /^func\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s+\*testing\.T\s*\)\s*\{/;

/**
 * Longest prefix of a `.Run(` call the scan will read before giving up. The first argument plus
 * its comma is a few dozen characters even when the call is spread over several lines; the cap
 * exists only so a truncated or malformed file cannot turn the scan into a walk to EOF.
 */
const GO_SUBTEST_SCAN_BUDGET = 4096;

/**
 * Advance past Go whitespace and comments, returning the index of the next
 * significant character, or `-1` if `limit` is reached first. Linear: every
 * character is visited at most once, no backtracking.
 */
function skipGoSpaceAndComments(src: string, start: number, limit: number): number {
  let i = start;
  while (i < limit) {
    if (SOURCE_WHITESPACE.has(src[i] ?? "")) {
      i++;
      continue;
    }
    const next = pastGoComment({ src, at: i, limit });
    if (next === i || next === -1) return next;
    i = next;
  }
  return -1;
}

/** Past a Go comment at `at`; `at` when none starts there, -1 when it runs past `limit`. */
function pastGoComment({ src, at, limit }: { src: string; at: number; limit: number }): number {
  if (src[at] !== "/") return at;
  if (src[at + 1] === "*") {
    const close = src.indexOf("*/", at + 2);
    return close === -1 || close + 2 > limit ? -1 : close + 2;
  }
  if (src[at + 1] === "/") {
    const nl = src.indexOf("\n", at);
    return nl === -1 || nl + 1 > limit ? -1 : nl + 1;
  }
  return at;
}

const SOURCE_WHITESPACE: ReadonlySet<string> = new Set([" ", "\t", "\n", "\r"]);

/**
 * The index just past an interpreted string or rune literal starting at
 * `start`, or -1 when it never closes: backslash escapes, never spans a line.
 */
function pastGoQuotedLiteral({
  rest,
  start,
  limit,
}: {
  rest: string;
  start: number;
  limit: number;
}): number {
  const quote = rest[start];
  let i = start + 1;
  while (i < limit) {
    const c = rest[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "\n") return -1;
    i++;
    if (c === quote) return i;
  }
  return -1;
}

/**
 * Is `rest` the start of a `t.Run("name", func(t *testing.T) { … }` subtest declaration?
 */
function isGoSubtestDeclaration(rest: string): boolean {
  const head = rest.match(GO_SUBTEST_HEAD_RE);
  if (!head) return false;

  const headLength = head[0]!.length;
  const limit = Math.min(rest.length, headLength + GO_SUBTEST_SCAN_BUDGET);
  const commaAt = topLevelCommaAt({ rest, start: headLength, limit });
  if (commaAt === -1) return false;

  const closureAt = skipGoSpaceAndComments(rest, commaAt + 1, limit);
  if (closureAt === -1) return false;

  return GO_SUBTEST_CLOSURE_RE.test(rest.slice(closureAt));
}

/**
 * Past a Go string, rune, raw string or comment at `i`: `i` when none starts
 * there, -1 when it is unterminated inside `limit`.
 */
function pastGoOpaque({ rest, i, limit }: { rest: string; i: number; limit: number }): number {
  const ch = rest[i];
  if (ch === '"' || ch === "'") return pastGoQuotedLiteral({ rest, start: i, limit });
  if (ch === "`") {
    // Raw string literal: no escapes, may span lines.
    const close = rest.indexOf("`", i + 1);
    return close === -1 || close >= limit ? -1 : close + 1;
  }
  if (ch === "/" && (rest[i + 1] === "/" || rest[i + 1] === "*")) {
    return skipGoSpaceAndComments(rest, i, limit);
  }
  return i;
}

/** The first comma outside any bracket, or -1 when the call closes first or the budget runs out. */
function topLevelCommaAt({
  rest,
  start,
  limit,
}: {
  rest: string;
  start: number;
  limit: number;
}): number {
  let depth = 0;
  let i = start;
  while (i < limit) {
    const next = pastGoOpaque({ rest, i, limit });
    if (next === -1) return -1;
    if (next !== i) {
      i = next;
      continue;
    }
    const ch = rest[i] ?? "";
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) {
      // The call closed before any top-level comma: `t.Run(name)` is not a subtest.
      if (depth === 0) return -1;
      depth--;
    }
    if (ch === "," && depth === 0) return i;
    i++;
  }
  return -1;
}

function isFollowedByGoTestFunc(src: string, start: number): boolean {
  const i = skipGoSpaceAndComments(src, start, src.length);
  if (i === -1) return false;

  const rest = src.slice(i);

  return GO_TEST_FUNC_RE.test(rest) || isGoSubtestDeclaration(rest);
}

export function collectGoBindings(testRoots: string[]): CollectedBinding[] {
  const bindings: CollectedBinding[] = [];
  const files: string[] = [];

  for (const r of testRoots) {
    files.push(...walkFiles(resolve(REPO_ROOT, r), (n) => GO_TEST_FILE_RE.test(n)));
  }

  for (const file of files) {
    const src = readFileSync(file, "utf8");

    for (const a of findScenarioAnnotations(src)) {
      if (!isFollowedByGoTestFunc(src, a.end)) continue;

      const line = src.slice(0, a.index).split("\n").length;

      bindings.push({
        title: a.title,
        ref: { file: relative(REPO_ROOT, file), line },
      });
    }
  }

  return bindings;
}

/** The offset just past the `(`-balanced group opening at `open`. */
function pastBalancedParens(src: string, open: number): number {
  const len = src.length;
  let depth = 1;
  let j = open + 1;

  while (j < len && depth > 0) {
    const c = src[j];

    if (c === "(") depth++;
    else if (c === ")") depth--;

    j++;
  }

  return j;
}

/**
 * The offset just past a Python decorator at `at`, including parenthesised
 * multi-line forms like @pytest.mark.parametrize("a,b", [...]).
 */
function pastPythonDecorator(src: string, at: number): number {
  const len = src.length;
  let j = at + 1;
  while (j < len && src[j] !== "\n" && src[j] !== "(") j++;

  if (j < len && src[j] === "(") j = pastBalancedParens(src, j);

  while (j < len && src[j] !== "\n") j++;

  return j + 1;
}

/**
 * Python binding form (block-comment matching the TS form, OR a hash
 * comment matching the Bats form — either is valid):
 *
 *   # @scenario "Boolean values match their numeric and string equivalents"
 *   def test_langeval_exact_match_js_loose_equality_match(...):
 *       ...
 *
 * The block-comment ANNOTATION_RE picks up `# @scenario <title>` because
 * the regex isn't comment-syntax aware — it matches the token wherever
 * it appears. Proximity check then requires the next non-blank,
 * non-comment line to begin with `def test_`.
 */
function isFollowedByPythonTestFunc(src: string, start: number): boolean {
  const len = src.length;
  let i = start;

  while (i < len) {
    const ch = src[i];

    if (SOURCE_WHITESPACE.has(ch ?? "")) {
      i++;
      continue;
    }

    if (ch === "#") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return false;

      i = nl + 1;
      continue;
    }

    if (ch === "@") {
      i = pastPythonDecorator(src, i);
      continue;
    }

    const rest = src.slice(i);

    return /^(?:async\s+)?def\s+test_[A-Za-z0-9_]*\s*\(/.test(rest);
  }

  return false;
}

const PYTHON_HASH_ANNOTATION_RE =
  /^[ \t]*#[ \t]*@scenario[ \t]+(?:"([^"\r\n]+)"|'([^'\r\n]+)')[ \t\r]*$/;

/** The `# @scenario "..."` bindings in one Python file (mirrors Bats). */
function pythonHashBindings({ file, src }: { file: string; src: string }): CollectedBinding[] {
  const bindings: CollectedBinding[] = [];
  const lines = src.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const hm = line.match(PYTHON_HASH_ANNOTATION_RE);
    if (!hm) continue;

    const title = (hm[1] ?? hm[2] ?? "").trim();
    if (!title) continue;

    // Use the same proximity check as the block form. Walk from the
    // start of the next line.
    const lineStartOffset = lines.slice(0, i + 1).reduce((acc, l) => acc + l.length + 1, 0);
    if (!isFollowedByPythonTestFunc(src, lineStartOffset)) continue;

    bindings.push({
      title,
      ref: { file: relative(REPO_ROOT, file), line: i + 1 },
    });
  }
  return bindings;
}

function collectPythonBindings(testRoots: string[]): CollectedBinding[] {
  const bindings: CollectedBinding[] = [];
  const files: string[] = [];

  for (const r of testRoots) {
    files.push(...walkFiles(resolve(REPO_ROOT, r), (n) => PYTHON_TEST_FILE_RE.test(n)));
  }

  for (const file of files) {
    const src = readFileSync(file, "utf8");

    // Block-comment form (mirrors TS / Go).
    for (const a of findScenarioAnnotations(src)) {
      if (!isFollowedByPythonTestFunc(src, a.end)) continue;

      const line = src.slice(0, a.index).split("\n").length;

      bindings.push({
        title: a.title,
        ref: { file: relative(REPO_ROOT, file), line },
      });
    }

    bindings.push(...pythonHashBindings({ file, src }));
  }

  return bindings;
}

/**
 * Hash-comment binding collector, shared by the bats and shell suites: both
 * spell the annotation `# @scenario "..."` and both require the next line that
 * is neither blank nor a comment to be the thing that runs. Only "what counts
 * as a test file" and "what counts as a test line" differ.
 */
function hashCommentBindingsInFile(
  file: string,
  isTestLine: (lines: string[], startLineIdx: number) => boolean,
): CollectedBinding[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const bindings: CollectedBinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] ?? "").match(BATS_ANNOTATION_RE);
    const title = (m?.[1] ?? m?.[2] ?? "").trim();
    if (!title || !isTestLine(lines, i + 1)) continue;

    bindings.push({
      title,
      ref: { file: relative(REPO_ROOT, file), line: i + 1 },
    });
  }

  return bindings;
}

function collectHashCommentBindings({
  testRoots,
  fileMatches,
  isTestLine,
}: {
  testRoots: string[];
  fileMatches: (name: string) => boolean;
  isTestLine: (lines: string[], startLineIdx: number) => boolean;
}): CollectedBinding[] {
  return testRoots
    .flatMap((r) => walkFiles(resolve(REPO_ROOT, r), fileMatches))
    .flatMap((file) => hashCommentBindingsInFile(file, isTestLine));
}

function collectBatsBindings(testRoots: string[]): CollectedBinding[] {
  return collectHashCommentBindings({
    testRoots,
    fileMatches: (n) => BATS_FILE_RE.test(n),
    isTestLine: isNextLineBatsTest,
  });
}

function collectShellBindings(testRoots: string[]): CollectedBinding[] {
  return collectHashCommentBindings({
    testRoots,
    fileMatches: (n) => SHELL_TEST_FILE_RE.test(n),
    isTestLine: isNextLineShellTest,
  });
}

function indexByTitle(bindings: CollectedBinding[]): Map<string, BindingRef[]> {
  const byTitle = new Map<string, BindingRef[]>();

  for (const b of bindings) {
    const existing = byTitle.get(b.title) ?? [];
    existing.push(b.ref);
    byTitle.set(b.title, existing);
  }

  return byTitle;
}

function isEnforcedScenario(s: Scenario): boolean {
  return s.tags.some((t) => BOUND_TAGS.has(t)) && !s.tags.includes(UNIMPLEMENTED_TAG);
}

function isUntaggedScenario(s: Scenario): boolean {
  return !s.tags.some((t) => BOUND_TAGS.has(t)) && !s.tags.includes(UNIMPLEMENTED_TAG);
}

function buildReport(featureRelPath: string, bindingsByTitle: Map<string, BindingRef[]>): Report {
  const absFeature = resolve(REPO_ROOT, featureRelPath);
  const allScenarios = parseFeature(absFeature);
  const scenarios = allScenarios.filter(isEnforcedScenario);
  const unbound: Scenario[] = [];

  const annotated: AnnotatedScenario[] = scenarios.map((s) => {
    const binds = bindingsByTitle.get(s.title) ?? [];
    if (binds.length === 0) unbound.push(s);

    return { ...s, bindings: binds };
  });

  const untagged = allScenarios.filter(isUntaggedScenario);

  return {
    feature: featureRelPath,
    scenarios: annotated,
    unbound,
    totalScenarios: allScenarios.length,
    unimplementedScenarios: allScenarios.filter((s) => s.tags.includes(UNIMPLEMENTED_TAG)).length,
    untaggedScenarios: untagged.length,
    untagged,
    unimplementedWithoutIssue: allScenarios.filter(
      (s) => s.tags.includes(UNIMPLEMENTED_TAG) && !s.citesIssue,
    ),
  };
}

/**
 * The floor under the `0/0 · ✓ all bound` trap: a file that declares scenarios
 * and enforces none of them. Printed as what it is; whether it fails is decided
 * per scenario (an untagged one must be frozen, a parked one must cite an issue).
 */
export function isInert(r: Pick<Report, "scenarios" | "totalScenarios">): boolean {
  return r.totalScenarios > 0 && r.scenarios.length === 0;
}

/**
 * Compares today's rule-breaking scenarios with the frozen pairs that tolerate them, counting
 * titles (a title held twice is listed twice). `fresh` breaks the rule unlisted; `stale` is
 * listed but no longer breaks it, and must leave the list.
 */
export function compareFrozenScenarios({
  observed,
  frozen,
}: {
  observed: readonly ScenarioRef[];
  frozen: Readonly<Record<string, readonly string[]>>;
}): { fresh: ScenarioRef[]; stale: ScenarioRef[] } {
  const remaining = new Map<string, number>();
  const keyOf = (feature: string, title: string) => `${feature}\u0000${title}`;

  for (const [feature, titles] of Object.entries(frozen)) {
    for (const title of titles) {
      const key = keyOf(feature, title);
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
  }

  const fresh: ScenarioRef[] = [];

  for (const ref of observed) {
    const key = keyOf(ref.feature, ref.title);
    const left = remaining.get(key) ?? 0;

    if (left > 0) remaining.set(key, left - 1);
    else fresh.push(ref);
  }

  const stale: ScenarioRef[] = [];

  for (const [feature, titles] of Object.entries(frozen)) {
    for (const title of titles) {
      const key = keyOf(feature, title);
      const left = remaining.get(key) ?? 0;

      if (left > 0) {
        remaining.set(key, left - 1);
        stale.push({ feature, title });
      }
    }
  }

  return { fresh, stale };
}

/** An `@scenario` annotation whose scenario carries no binding tag, so binds nothing. */
export interface AnnotationOnUntagged {
  title: string;
  ref: BindingRef;
  scenario: ScenarioRef;
  missingTag: string;
  /** The scenario is parked as `@unimplemented` although a test now binds it. */
  parked: boolean;
}

/**
 * The tag a test's own file says its scenario is missing: the lane it runs in,
 * read from its name, and `@unit` when the name says nothing.
 */
export function laneTagForTest(testFile: string): string {
  if (/\.integration\.|\/integration\//.test(testFile)) return "@integration";
  if (/\.e2e\.|\/e2e\//.test(testFile)) return "@e2e";
  if (/\.regression\./.test(testFile)) return "@regression";
  if (/\.scenario\.test\./.test(testFile)) return "@e2e";

  return "@unit";
}

/**
 * Annotations naming a scenario none of whose declarations carries a binding
 * tag. The test looks bound and the gate measures nothing: the scenario is
 * invisible to the bound count however many tests point at it.
 */
export function findAnnotationsOnUntaggedScenarios({
  bindings,
  scenarios,
}: {
  bindings: readonly CollectedBinding[];
  scenarios: readonly { feature: string; scenario: Scenario }[];
}): AnnotationOnUntagged[] {
  const byTitle = new Map<string, { feature: string; scenario: Scenario }[]>();

  for (const entry of scenarios) {
    const list = byTitle.get(entry.scenario.title);

    if (list) list.push(entry);
    else byTitle.set(entry.scenario.title, [entry]);
  }

  const found: AnnotationOnUntagged[] = [];

  for (const b of bindings) {
    const declared = byTitle.get(b.title);

    if (!declared) continue;
    const isBound = declared.some(({ scenario }) => scenario.tags.some((t) => BOUND_TAGS.has(t)));
    if (isBound) continue;

    const first = declared[0]!;

    found.push({
      title: b.title,
      ref: b.ref,
      scenario: { feature: first.feature, title: b.title, line: first.scenario.line },
      missingTag: laneTagForTest(b.ref.file),
      parked: first.scenario.tags.includes(UNIMPLEMENTED_TAG),
    });
  }

  return found;
}

export function formatAnnotationsOnUntagged(found: readonly AnnotationOnUntagged[]): string[] {
  if (found.length === 0) return [];

  const lines = [`\nAnnotations binding a scenario that carries no binding tag:`];

  for (const a of found) {
    lines.push(`  ✗ ${a.ref.file}:${a.ref.line} @scenario "${a.title}"`);

    lines.push(
      a.parked
        ? `      binds ${a.scenario.feature}:${a.scenario.line}, which is @unimplemented and missing ${a.missingTag}. Replace @unimplemented with ${a.missingTag} (the lane the test runs in), or remove the annotation.`
        : `      binds ${a.scenario.feature}:${a.scenario.line}, which is missing ${a.missingTag}. Add ${a.missingTag} (the lane the test runs in) to that scenario, or remove the annotation.`,
    );
  }

  return lines;
}

export function formatFrozenScenarioFailures({
  untagged,
  unimplementedWithoutIssue,
  annotatedUntagged = [],
}: {
  untagged: { fresh: readonly ScenarioRef[]; stale: readonly ScenarioRef[] };
  unimplementedWithoutIssue: { fresh: readonly ScenarioRef[]; stale: readonly ScenarioRef[] };
  /** Stale `annotatedUntagged` entries; fresh ones print via `formatAnnotationsOnUntagged`. */
  annotatedUntagged?: readonly ScenarioRef[];
}): string[] {
  const lines: string[] = [];

  if (untagged.fresh.length > 0) {
    lines.push(`\nScenarios carrying no binding tag:`);

    for (const s of untagged.fresh) {
      lines.push(`  ✗ ${s.feature}:${s.line} "${s.title}"`);

      lines.push(
        `      Tag it @unit / @integration / @e2e / @regression and bind a test with /** @scenario "${s.title}" */, tag it @unimplemented with an @issue:<number> tag, or delete it.`,
      );
    }
  }

  if (unimplementedWithoutIssue.fresh.length > 0) {
    lines.push(`\n@unimplemented scenarios citing no tracked issue:`);

    for (const s of unimplementedWithoutIssue.fresh) {
      lines.push(`  ✗ ${s.feature}:${s.line} "${s.title}"`);

      lines.push(
        `      Add an @issue:<number> tag to it, or a comment line directly above its tags naming #<number>.`,
      );
    }
  }

  for (const [list, stale] of [
    ["untagged", untagged.stale],
    ["unimplementedWithoutIssue", unimplementedWithoutIssue.stale],
    ["annotatedUntagged", annotatedUntagged],
  ] as const) {
    if (stale.length === 0) continue;

    lines.push(
      `\nFrozen entries that no longer apply (remove them from "${list}" in ${FROZEN_SCENARIOS_RELATIVE}):`,
    );

    for (const s of stale) lines.push(`  ✗ ${s.feature} "${s.title}"`);
  }

  return lines;
}

function toInertReport(r: Report): InertReport {
  return {
    feature: r.feature,
    totalScenarios: r.totalScenarios,
    unimplemented: r.unimplementedScenarios,
  };
}

function toLegacyReport(r: Report): LegacyReport {
  return {
    feature: r.feature,
    bound: r.scenarios.length - r.unbound.length,
    unbound: r.unbound.length,
    total: r.scenarios.length,
    unboundTitles: r.unbound.map((s) => s.title),
  };
}

function printEnforcedReport(r: Report): void {
  const total = r.scenarios.length;
  const boundCount = total - r.unbound.length;
  console.log(`\n▸ ${r.feature}`);

  // Never print `0/0 · ✓ all bound` — that is the sentence this check exists to
  // stop telling. Say what is actually true: nothing here is measured.
  if (isInert(r)) {
    console.log(`  ${describeInert(toInertReport(r))}`);

    return;
  }

  // `N/N scenarios bound` on a file with untagged scenarios alongside is the
  // partial-file variant of the inert trap: say what the count measures and
  // what it cannot see, in the same line.
  if (r.untaggedScenarios > 0) {
    console.log(
      `  ${boundCount}/${total} tagged scenario(s) bound · ${r.untaggedScenarios} scenario(s) untagged and unmeasured`,
    );
  } else {
    console.log(`  ${boundCount}/${total} scenarios bound`);
  }

  if (total === 0) {
    console.log(`  · no scenarios declared`);

    return;
  }

  if (r.unbound.length === 0) {
    console.log(`  ✓ all bound`);

    return;
  }

  console.log(`\n  Unbound scenarios:`);

  for (const s of r.unbound) {
    const tags = s.tags.join(" ");
    console.log(`    ✗ [${tags}] ${s.title}`);
    console.log(`      ${r.feature}:${s.line}`);

    console.log(
      `      Add: /** @scenario ${s.title} */ above an it(...) test, or # @scenario "${s.title}" above an @test in a .bats file`,
    );
  }
}

function printLegacySummary(reports: LegacyReport[]): void {
  if (reports.length === 0) return;

  const totalUnbound = reports.reduce((s, r) => s + r.unbound, 0);
  const totalBound = reports.reduce((s, r) => s + r.bound, 0);
  const totalScenarios = reports.reduce((s, r) => s + r.total, 0);
  console.log(`\nLegacy (tolerated — not failing CI):`);

  console.log(
    `  ${reports.length} file(s), ${totalBound}/${totalScenarios} bound, ${totalUnbound} unbound`,
  );

  for (const r of reports) {
    console.log(`  · ${r.feature}  ${r.bound}/${r.total} bound, ${r.unbound} unbound`);
  }

  console.log(
    `\n  Shrink this list by binding scenarios, flagging @unimplemented, or removing stale scenarios. See dev/docs/TESTING_PHILOSOPHY.md.`,
  );
}

/** Why a file enforces nothing — untagged, parked, or a mix of the two. */
function describeInert(r: InertReport): string {
  const head = `0 of ${r.totalScenarios} scenario(s) enforced`;

  if (r.unimplemented === 0) {
    return `${head} — none tagged @unit/@integration/@e2e/@regression`;
  }

  if (r.unimplemented === r.totalScenarios) {
    return `${head} — every scenario is @unimplemented`;
  }

  return `${head} — ${r.unimplemented} @unimplemented, the rest untagged`;
}

function printInertSummary(reports: InertReport[]): void {
  if (reports.length === 0) return;

  const invisible = reports.reduce((s, r) => s + r.totalScenarios, 0);
  const parked = reports.reduce((s, r) => s + r.unimplemented, 0);
  console.log(`\nInert (no enforced scenarios):`);

  console.log(
    `  ${reports.length} file(s) hold ${invisible} scenario(s) this check cannot see` +
      (parked > 0 ? ` (${parked} of them parked as @unimplemented).` : "."),
  );

  console.log(
    `  Tag them @unit/@integration to measure them, or @unimplemented with an issue to declare the gap. See dev/docs/TESTING_PHILOSOPHY.md.`,
  );
}

/**
 * The verdict, above the per-file sections as well as below them.
 */
export function formatFailureBanner(reasons: string[]): string[] {
  if (reasons.length === 0) return [];

  return [
    `\n✗ THIS RUN FAILS: ${reasons.join(", ")}.`,
    `  A ✓ below means that feature file is fully bound, not that the run passed.`,
  ];
}

/**
 * Unknown annotations, grouped under the file they were written in. They belong to no `▸`
 * feature section, because the scenario they name is in no feature file at all, so a flat
 * trailing list leaves them unattributed and far from the change that introduced them.
 */
export function formatUnknownAnnotations(unknown: UnknownAnnotation[]): string[] {
  if (unknown.length === 0) return [];

  const lines = [
    `\nAnnotations referencing unknown scenarios (typo? renamed scenario? stale binding?):`,
  ];

  const byFile = new Map<string, UnknownAnnotation[]>();

  for (const a of unknown) {
    const list = byFile.get(a.ref.file);

    if (list) list.push(a);
    else byFile.set(a.ref.file, [a]);
  }

  for (const [file, entries] of [...byFile].toSorted(([a], [b]) => a.localeCompare(b))) {
    lines.push(`\n  ▸ ${file}`);

    for (const a of entries) {
      lines.push(`    ✗ @scenario ${a.title}`);
      lines.push(`      line ${a.ref.line}`);
    }
  }

  return lines;
}

function printUnknownAnnotations(unknown: UnknownAnnotation[]): void {
  for (const line of formatUnknownAnnotations(unknown)) console.log(line);
}

function validateExemptionList({
  name,
  entries,
  allFeatures,
}: {
  name: string;
  entries: readonly string[];
  allFeatures: string[];
}): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry)) {
      errors.push(`${name} contains duplicate entry: ${entry}`);
      continue;
    }

    seen.add(entry);

    if (!allFeatures.includes(entry)) {
      const abs = resolve(REPO_ROOT, entry);

      if (!existsSync(abs)) {
        errors.push(`${name} entry does not resolve to an existing .feature file: ${entry}`);
      } else {
        errors.push(`${name} entry is not discovered under the configured spec roots: ${entry}`);
      }
    }
  }

  return errors;
}

/**
 * Everything the check has worked out, before any of it is printed or judged.
 * The report, the verdict and the JSON payload are three views of this one
 * value, so none of them can disagree with the others about what was found.
 */
interface ParityAnalysis {
  enforced: Report[];
  legacy: LegacyReport[];
  /** Files that enforce no scenario at all, printed so the blind spot stays visible. */
  inert: InertReport[];
  /** Untagged scenarios against the frozen `untagged` pairs. */
  untagged: { fresh: ScenarioRef[]; stale: ScenarioRef[]; tolerated: number };
  /** `@unimplemented` scenarios citing no issue against the frozen pairs. */
  unimplementedWithoutIssue: { fresh: ScenarioRef[]; stale: ScenarioRef[]; tolerated: number };
  /** Annotations on untagged scenarios; `fresh` are the ones not frozen. */
  annotationsOnUntagged: {
    fresh: AnnotationOnUntagged[];
    stale: ScenarioRef[];
    tolerated: number;
  };
  /** Entries that no longer belong on their list, and must leave it. Fatal. */
  staleLegacy: LegacyReport[];
  unknownAnnotations: UnknownAnnotation[];
  listErrors: string[];
}

function refsOf(reports: readonly Report[], pick: (r: Report) => Scenario[]): ScenarioRef[] {
  return reports.flatMap((r) =>
    pick(r).map((s) => ({ feature: r.feature, title: s.title, line: s.line })),
  );
}

function withTolerated(
  observed: readonly ScenarioRef[],
  frozen: Readonly<Record<string, readonly string[]>>,
): { fresh: ScenarioRef[]; stale: ScenarioRef[]; tolerated: number } {
  const { fresh, stale } = compareFrozenScenarios({ observed, frozen });

  return { fresh, stale, tolerated: observed.length - fresh.length };
}

function frozenAnnotations({
  found,
  frozen,
}: {
  found: AnnotationOnUntagged[];
  frozen: Readonly<Record<string, readonly string[]>>;
}): ParityAnalysis["annotationsOnUntagged"] {
  const observed = found.map((a) => ({ feature: a.ref.file, title: a.title, line: a.ref.line }));
  const { fresh, stale } = compareFrozenScenarios({ observed, frozen });
  const freshKeys = new Set(fresh.map((r) => `${r.feature}:${r.line}`));

  return {
    fresh: found.filter((a) => freshKeys.has(`${a.ref.file}:${a.ref.line}`)),
    stale,
    tolerated: found.length - fresh.length,
  };
}

function analyzeParity(): ParityAnalysis {
  const allFeatures = discoverFeatureFiles();
  const frozen = loadFrozenScenarios();

  const listErrors = validateExemptionList({
    name: "LEGACY_UNBOUND",
    entries: LEGACY_UNBOUND,
    allFeatures,
  });

  const bindings = [
    ...collectAllBindings(DEFAULT_TEST_ROOTS),
    ...collectBatsBindings(DEFAULT_BATS_TEST_ROOTS),
    ...collectShellBindings(DEFAULT_SHELL_TEST_ROOTS),
    ...collectGoBindings(DEFAULT_GO_TEST_ROOTS),
    ...collectPythonBindings(DEFAULT_PYTHON_TEST_ROOTS),
  ];

  const bindingsByTitle = indexByTitle(bindings);

  const declared = allFeatures.flatMap((feature) =>
    parseFeature(resolve(REPO_ROOT, feature)).map((scenario) => ({ feature, scenario })),
  );

  const allKnownTitles = new Set(declared.map(({ scenario }) => scenario.title));

  const unknownAnnotations: UnknownAnnotation[] = bindings
    .filter((b) => !allKnownTitles.has(b.title))
    .map((b) => ({ title: b.title, ref: b.ref }));

  const legacySet = new Set(LEGACY_UNBOUND);
  const allReports: Report[] = [];
  const enforced: Report[] = [];
  const legacy: LegacyReport[] = [];

  for (const f of allFeatures) {
    const report = buildReport(f, bindingsByTitle);
    allReports.push(report);

    if (legacySet.has(f)) {
      legacy.push(toLegacyReport(report));
    } else {
      enforced.push(report);
    }
  }

  return {
    enforced,
    legacy,
    inert: allReports.filter(isInert).map(toInertReport),
    // Per scenario, across every file, legacy ones included: a listed file can
    // no longer hide a new untagged scenario behind its older ones.
    untagged: withTolerated(
      refsOf(allReports, (r) => r.untagged),
      frozen.untagged,
    ),
    unimplementedWithoutIssue: withTolerated(
      refsOf(allReports, (r) => r.unimplementedWithoutIssue),
      frozen.unimplementedWithoutIssue,
    ),
    annotationsOnUntagged: frozenAnnotations({
      found: findAnnotationsOnUntaggedScenarios({ bindings, scenarios: declared }),
      frozen: frozen.annotatedUntagged,
    }),
    // Legacy-list hygiene: every entry must still have at least one unbound
    // scenario. If a file is fully bound, it must be removed from the list.
    staleLegacy: legacy.filter((r) => r.unbound === 0),
    unknownAnnotations,
    listErrors,
  };
}

function printParityReport(a: ParityAnalysis): void {
  console.log("Feature-file parity check");
  console.log("=========================");

  console.log(
    `Enforced: ${a.enforced.length} file(s) · Legacy: ${a.legacy.length} file(s) · Inert: ${a.inert.length} file(s)`,
  );

  // The verdict goes above the per-file sections as well as below them. Every `✓ all bound`
  // under a `▸` heading is scoped to that one feature file, and a run can fail on something
  // that belongs to no heading at all, so reading the tick next to your own change and stopping
  // there is the obvious mistake. The reasons come from the same function the exit code does,
  // so this banner and the trailing FAIL line cannot disagree.
  for (const line of formatFailureBanner(fatalReasons(a))) console.log(line);

  for (const r of a.enforced) printEnforcedReport(r);

  printLegacySummary(a.legacy);
  printInertSummary(a.inert);
  printUnknownAnnotations(a.unknownAnnotations);
  for (const line of formatAnnotationsOnUntagged(a.annotationsOnUntagged.fresh)) console.log(line);

  for (const line of formatFrozenScenarioFailures({
    untagged: a.untagged,
    unimplementedWithoutIssue: a.unimplementedWithoutIssue,
    annotatedUntagged: a.annotationsOnUntagged.stale,
  })) {
    console.log(line);
  }
}

/**
 * Why the check fails, in the words the failure is reported with. Empty means
 * it passes: the verdict and the message come from the same list, so the check
 * cannot exit non-zero without saying what for.
 */
function fatalReasons(a: ParityAnalysis): string[] {
  const reasons: string[] = [];
  const enforcedUnbound = a.enforced.reduce((s, r) => s + r.unbound.length, 0);

  if (enforcedUnbound > 0) {
    reasons.push(`${enforcedUnbound} unbound scenario(s) in enforced files`);
  }

  if (a.unknownAnnotations.length > 0) {
    reasons.push(`${a.unknownAnnotations.length} unknown annotation(s)`);
  }

  if (a.staleLegacy.length > 0) {
    reasons.push(
      `${a.staleLegacy.length} fully-bound file(s) still in LEGACY_UNBOUND — remove them from the list: ${a.staleLegacy
        .map((r) => r.feature)
        .join(", ")}`,
    );
  }

  if (a.annotationsOnUntagged.fresh.length > 0) {
    reasons.push(
      `${a.annotationsOnUntagged.fresh.length} @scenario annotation(s) bind a scenario carrying no binding tag — tag the scenario with the lane its test runs in`,
    );
  }

  if (a.untagged.fresh.length > 0) {
    reasons.push(
      `${a.untagged.fresh.length} scenario(s) carry no binding tag — tag them @unit/@integration/@e2e/@regression and bind them, tag them @unimplemented with an issue, or delete them`,
    );
  }

  if (a.unimplementedWithoutIssue.fresh.length > 0) {
    reasons.push(
      `${a.unimplementedWithoutIssue.fresh.length} @unimplemented scenario(s) cite no tracked issue — add an @issue:<number> tag or a #<number> comment directly above`,
    );
  }

  const stale =
    a.untagged.stale.length +
    a.unimplementedWithoutIssue.stale.length +
    a.annotationsOnUntagged.stale.length;

  if (stale > 0) {
    reasons.push(
      `${stale} frozen scenario entr(y/ies) no longer apply — remove them from ${FROZEN_SCENARIOS_RELATIVE}`,
    );
  }

  if (a.listErrors.length > 0) {
    reasons.push(`${a.listErrors.length} exemption-list error(s)`);
  }

  return reasons;
}

function printOkSummary(a: ParityAnalysis): void {
  const enforcedTotal = a.enforced.reduce((s, r) => s + r.scenarios.length, 0);
  const legacyUnbound = a.legacy.reduce((s, r) => s + r.unbound, 0);

  console.log(
    `\nOK: ${enforcedTotal} enforced scenario(s) bound across ${a.enforced.length} file(s).`,
  );

  if (a.legacy.length > 0) {
    console.log(
      `    ${legacyUnbound} unbound scenario(s) tolerated in ${a.legacy.length} legacy file(s).`,
    );
  }

  if (a.untagged.tolerated > 0) {
    console.log(
      `    ${a.untagged.tolerated} untagged scenario(s) tolerated by name in ${FROZEN_SCENARIOS_RELATIVE}, invisible to this check.`,
    );
  }

  if (a.unimplementedWithoutIssue.tolerated > 0) {
    console.log(
      `    ${a.unimplementedWithoutIssue.tolerated} @unimplemented scenario(s) citing no issue tolerated by name in the same file.`,
    );
  }

  if (a.annotationsOnUntagged.tolerated > 0) {
    console.log(
      `    ${a.annotationsOnUntagged.tolerated} @scenario annotation(s) on a scenario with no binding tag tolerated by name in the same file.`,
    );
  }
}

function main(): void {
  const asJson = process.argv.slice(2).includes("--json");
  const analysis = analyzeParity();

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          enforced: analysis.enforced,
          legacy: analysis.legacy,
          unknownAnnotations: analysis.unknownAnnotations,
          listErrors: analysis.listErrors,
          staleLegacy: analysis.staleLegacy.map((r) => r.feature),
          inert: analysis.inert,
          untagged: analysis.untagged,
          unimplementedWithoutIssue: analysis.unimplementedWithoutIssue,
          annotationsOnUntagged: analysis.annotationsOnUntagged,
        },
        null,
        2,
      ),
    );
  } else {
    printParityReport(analysis);
  }

  const reasons = fatalReasons(analysis);

  if (reasons.length > 0) {
    if (!asJson) {
      // The list name is already inside each message.
      for (const err of analysis.listErrors) {
        console.error(`Exemption list: ${err}`);
      }

      console.error(
        `FAIL: ${reasons.join(
          ", ",
        )}. See spec-binding convention in dev/docs/TESTING_PHILOSOPHY.md.`,
      );
    }

    process.exit(1);
  }

  if (!asJson) printOkSummary(analysis);
}

/**
 * Is this module the one node was asked to run?
 */
export function isEntryModule({
  invokedPath,
  modulePath,
}: {
  invokedPath: string | undefined;
  modulePath: string;
}): boolean {
  if (invokedPath === undefined) return false;

  return realPathOrResolved(invokedPath) === realPathOrResolved(modulePath);
}

function realPathOrResolved(p: string): string {
  const abs = resolve(p);

  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

// Run only when invoked as a script (`tsx scripts/check-feature-parity.ts`),
// so the collectors above can be imported and exercised by unit tests without
// the whole repo scan — and its `process.exit(1)` — running on import.
if (isEntryModule({ invokedPath: process.argv[1], modulePath: __filename })) {
  main();
}
