#!/usr/bin/env tsx
/**
 * Feature-parity check: every `@integration` / `@unit` scenario in every
 * `.feature` file under `specs/**` must be bound to at least one test via a
 * `@scenario "<title>"` JSDoc annotation.
 *
 * Enforces the "Feature File Parity" rule from
 * dev/docs/TESTING_PHILOSOPHY.md. Without this check, feature files can drift
 * into documentation that nobody verifies.
 *
 * Polarity: enforce-all by default. Files listed in `LEGACY_UNBOUND` are
 * tolerated during migration — they still parse and are reported in the
 * `legacy` block, but unbound scenarios in those files do NOT fail CI.
 * Shrinking the deny-list toward zero is the work tracked by #3338.
 *
 * Usage:
 *   pnpm check:feature-parity              # exit 1 if any enforced unbound
 *   pnpm check:feature-parity --json       # machine-readable report
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, relative, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, "../..");
const SPECS_ROOT = resolve(REPO_ROOT, "specs");

/**
 * Test roots scanned for `@scenario` bindings. Every `.test.ts` /
 * `.test.tsx` file under these roots is parsed for annotations. A binding
 * matches by scenario title, so proximity of the feature file to the test
 * is not required — any test in these roots can bind any scenario.
 */
const DEFAULT_TEST_ROOTS: string[] = [
  "langwatch/src",
  "langwatch/ee",
  "mcp-server/src",
  "typescript-sdk/src",
  "python-sdk/src",
];

/**
 * Feature files whose unbound `@unit` / `@integration` scenarios are
 * tolerated (non-fatal) during migration. These files still parse; their
 * counts surface in the `legacy` block of `--json` output and in the
 * human-readable summary so shrinkage is visible.
 *
 * Direction: drive this list to empty. Adding a new file here should
 * require justification — prefer to bind, flag @unimplemented, or remove
 * the scenario.
 *
 * Invariants (enforced below):
 *   - Every path must resolve to an existing `.feature` file.
 *   - Every entry must actually contain at least one unbound `@unit` /
 *     `@integration` scenario. Fully-bound files must be removed — this
 *     prevents the list from rotting.
 */
const LEGACY_UNBOUND: string[] = [
  // Seeded 2026-04-24 from a full discover-pass: every `.feature` file that
  // currently has at least one unbound `@unit` / `@integration` scenario.
  // #3338 binds these down to zero; every removal here means either a new
  // `@scenario` binding on a test, an `@unimplemented` tag in the feature,
  // or a scenario removed as aspirational.
  "specs/agents/agent-management.feature",
  "specs/agents/agents-rest-api.feature",
  "specs/agents/create-workflow-agent.feature",
  "specs/agents/http-agent-tracing.feature",
  "specs/agents/workflow-agent-editor.feature",
  "specs/analytics/chart-rendering.feature",
  "specs/analytics/clickhouse-column-pruning.feature",
  "specs/analytics/clickhouse-memory-safety.feature",
  "specs/analytics/clickhouse-structured-logging-alerting.feature",
  "specs/auth/phase-1-better-auth-config.feature",
  "specs/auth/phase-2-cutover-migration.feature",
  "specs/auth/phase-3-big-swap.feature",
  "specs/background/redis-cluster-compatibility.feature",
  "specs/batch-evaluation-results/batch-evaluation-results.feature",
  "specs/batch-evaluation-results/experiment-cost-folding.feature",
  "specs/batch-evaluation-results/target-metadata-api.feature",
  "specs/billing/subscription-cancellation.feature",
  "specs/components/code-block-editor.feature",
  "specs/components/hoverable-big-text-overflow.feature",
  "specs/components/search-input.feature",
  "specs/evaluations-v3/autosave-status.feature",
  "specs/evaluations-v3/ci-cd-execution.feature",
  "specs/evaluations-v3/dataset-inline-editing.feature",
  "specs/evaluations-v3/dataset-management.feature",
  "specs/evaluations-v3/evaluation-execution.feature",
  "specs/evaluations-v3/evaluation-history.feature",
  "specs/evaluations-v3/evaluator-as-target.feature",
  "specs/evaluations-v3/evaluator-configuration.feature",
  "specs/evaluations-v3/execution-backend.feature",
  "specs/evaluations-v3/experiment-slug-deduplication.feature",
  "specs/evaluations-v3/http-agent-support.feature",
  "specs/evaluations-v3/runner-configuration.feature",
  "specs/evaluations-v3/table-display.feature",
  "specs/evaluations-v3/undo-redo.feature",
  "specs/evaluators/azure-safety-byok-gating.feature",
  "specs/evaluators/create-workflow-evaluator.feature",
  "specs/evaluators/evaluator-error-propagation.feature",
  "specs/evaluators/evaluator-management.feature",
  "specs/evaluators/satisfaction-score-migration.feature",
  "specs/evaluators/workflow-evaluator-editor.feature",
  "specs/features/beta-pill.feature",
  "specs/features/customer-io-nurturing-integration.feature",
  "specs/features/dataset-cli.feature",
  "specs/features/dataset-file-upload-api.feature",
  "specs/features/dataset-mcp-tools.feature",
  "specs/features/dataset-python-sdk.feature",
  "specs/features/dataset-rest-api.feature",
  "specs/features/dataset-typescript-sdk.feature",
  "specs/features/devtools/bullboard-queue-dashboard.feature",
  "specs/features/devtools/issue-creation-skill.feature",
  "specs/features/devtools/orchestrator-bug-fix-workflow.feature",
  "specs/features/devtools/worktree-creation.feature",
  "specs/features/drawer-backdrop-transparency-blur.feature",
  "specs/features/elasticsearch-write-disable-flags.feature",
  "specs/features/enterprise-feature-guards.feature",
  "specs/features/evaluations-v3/evaluator-run-rerun-enhancements.feature",
  "specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature",
  "specs/features/onboarding/mcp-setup-prompt-compatibility.feature",
  "specs/features/onboarding/welcome-screens.feature",
  "specs/features/platform-evaluator-and-model-provider-tools.feature",
  "specs/features/pricing-model-aware-free-plan.feature",
  "specs/features/prompts/custom-prompt-tags.feature",
  "specs/features/remove-dead-cost-checker-code.feature",
  "specs/features/scenarios/extensible-scenario-metadata.feature",
  "specs/features/scenarios/on-prem-hostname-validation.feature",
  "specs/features/scenarios/run-view-side-by-side-layout.feature",
  "specs/features/scenarios/scenario-id-format.feature",
  "specs/features/scenarios/scenario-run-status-config-location.feature",
  "specs/features/scenarios/unified-agent-target-section.feature",
  "specs/features/scim-group-mapping.feature",
  "specs/features/settings-plans-comparison.feature",
  "specs/features/signup-slack-notifications.feature",
  "specs/features/stripe-price-catalog-sync.feature",
  "specs/features/subscription-service-refactor.feature",
  "specs/features/suites/all-runs-batch-origin-label.feature",
  "specs/features/suites/all-runs-default-open.feature",
  "specs/features/suites/all-runs-group-by.feature",
  "specs/features/suites/all-runs-panel.feature",
  "specs/features/suites/all-runs-scenario-names.feature",
  "specs/features/suites/cancel-queued-running-jobs.feature",
  "specs/features/suites/collapsible-suite-sidebar.feature",
  "specs/features/suites/external-sdk-ci-sets-in-sidebar.feature",
  "specs/features/suites/footer-to-header-migration.feature",
  "specs/features/suites/grid-view-and-borderless-tables.feature",
  "specs/features/suites/inline-add-target-and-scenario-buttons.feature",
  "specs/features/suites/nested-drawer-typing.feature",
  "specs/features/suites/real-time-run-updates.feature",
  "specs/features/suites/remove-label-tag-pills.feature",
  "specs/features/suites/remove-redundant-suites-label.feature",
  "specs/features/suites/rename-suites-to-runs.feature",
  "specs/features/suites/run-history-group-by.feature",
  "specs/features/suites/run-scenario-target-selector-modal-stability.feature",
  "specs/features/suites/single-loading-indicator.feature",
  "specs/features/suites/suite-archive-confirmation-dialog.feature",
  "specs/features/suites/suite-bugfixes-1956.feature",
  "specs/features/suites/suite-empty-state.feature",
  "specs/features/suites/suite-list-view-status.feature",
  "specs/features/suites/suite-run-confirmation-modal.feature",
  "specs/features/suites/suite-runs-time-filter.feature",
  "specs/features/suites/suite-sidebar-status-summary.feature",
  "specs/features/suites/suite-url-nesting.feature",
  "specs/features/suites/suite-url-routing.feature",
  "specs/features/suites/target-selector-select-clear-all.feature",
  "specs/features/suites/unified-run-table.feature",
  "specs/features/suites/unified-run-view-layout.feature",
  "specs/features/suites/unified-sidebar-list-items.feature",
  "specs/features/tag-management.feature",
  "specs/features/trace-limit-upgrade-message.feature",
  "specs/features/user-deactivation.feature",
  "specs/features/webhook-service-refactor.feature",
  "specs/home/learning-resources.feature",
  "specs/home/onboarding-progress-backend.feature",
  "specs/home/onboarding-progress-ui.feature",
  "specs/home/quick-access-links.feature",
  "specs/home/recent-items-backend.feature",
  "specs/home/recent-items-ui.feature",
  "specs/home/welcome-header.feature",
  "specs/licensing/billing-meter-dispatch.feature",
  "specs/licensing/dual-pricing-model.feature",
  "specs/licensing/enforcement-hono-api.feature",
  "specs/licensing/enforcement-members.feature",
  "specs/licensing/enforcement-messages.feature",
  "specs/licensing/enforcement-projects.feature",
  "specs/licensing/enforcement-resources.feature",
  "specs/licensing/license-activation-ui.feature",
  "specs/licensing/license-enforcement-refactor.feature",
  "specs/licensing/license-generation.feature",
  "specs/licensing/license-lifecycle-e2e.feature",
  "specs/licensing/license-page-styling.feature",
  "specs/licensing/license-router.feature",
  "specs/licensing/license-status-ui.feature",
  "specs/licensing/license-validation.feature",
  "specs/licensing/notification-coverage-gaps.feature",
  "specs/licensing/plan-mapping.feature",
  "specs/licensing/proration-preview.feature",
  "specs/licensing/resource-limit-notifications.feature",
  "specs/licensing/self-serving-license-purchase.feature",
  "specs/licensing/subscription-handler-integration.feature",
  "specs/licensing/subscription-limit-overrides.feature",
  "specs/licensing/subscription-page.feature",
  "specs/licensing/upgrade-modal-variant-system.feature",
  "specs/licensing/usage-page-navigation.feature",
  "specs/mcp-server/analytics-tool.feature",
  "specs/mcp-server/mcp-in-app.feature",
  "specs/mcp-server/prompt-tools.feature",
  "specs/mcp-server/scenario-tool-formatters.feature",
  "specs/mcp-server/scenario-tools.feature",
  "specs/mcp-server/schema-discovery.feature",
  "specs/mcp-server/trace-tools.feature",
  "specs/members/member-role-team-restrictions.feature",
  "specs/members/update-pending-invitation.feature",
  "specs/model-config/anthropic-empty-content.feature",
  "specs/model-config/litellm-model-id-translation.feature",
  "specs/model-config/litellm-reasoning-params.feature",
  "specs/model-config/model-parameter-constraints.feature",
  "specs/model-config/model-parameter-display.feature",
  "specs/model-config/model-registry-sync.feature",
  "specs/model-config/model-selector-ux.feature",
  "specs/model-config/unified-reasoning-form.feature",
  "specs/model-config/unified-reasoning-ui.feature",
  "specs/model-config/unified-reasoning.feature",
  "specs/model-providers/azure-safety-provider.feature",
  "specs/model-providers/credential-validation.feature",
  "specs/model-providers/custom-models-management.feature",
  "specs/model-providers/default-provider.feature",
  "specs/model-providers/onboarding-flow.feature",
  "specs/model-providers/provider-configuration.feature",
  "specs/model-providers/provider-deletion.feature",
  "specs/model-providers/provider-list.feature",
  "specs/monitors/evaluator-slug.feature",
  "specs/monitors/formatted-trace-mapping.feature",
  "specs/monitors/guardrails-api-compatibility.feature",
  "specs/monitors/guardrails-drawer.feature",
  "specs/monitors/monitor-execution-backend.feature",
  "specs/monitors/monitor-trace-mappings.feature",
  "specs/monitors/nested-trace-mapping-ui.feature",
  "specs/monitors/new-evaluation-menu.feature",
  "specs/monitors/online-evaluation-drawer-flow.feature",
  "specs/monitors/online-evaluation-drawer.feature",
  "specs/monitors/online-evaluation-preconditions.feature",
  "specs/monitors/pending-mappings-validation.feature",
  "specs/monitors/workflow-evaluator-checktype.feature",
  "specs/monitors/workflow-evaluator-mappings.feature",
  "specs/navigation/child-drawer-nesting.feature",
  "specs/navigation/home-navigation.feature",
  "specs/private-dataplane/clickhouse-routing.feature",
  "specs/private-dataplane/data-isolation.feature",
  "specs/private-dataplane/s3-routing.feature",
  "specs/projects/create-project-drawer.feature",
  "specs/projects/project-creation-flow.feature",
  "specs/projects/project-list-refresh.feature",
  "specs/prompts/custom-labels-deploy-dialog.feature",
  "specs/prompts/custom-prompt-tags.feature",
  "specs/prompts/deploy-prompt-dialog.feature",
  "specs/prompts/liquid-template-support.feature",
  "specs/prompts/open-existing-prompt-from-trace.feature",
  "specs/prompts/open-trace-in-playground.feature",
  "specs/prompts/prompt-selection-drawer.feature",
  "specs/prompts/prompt-soft-delete.feature",
  "specs/prompts/prompt-tags.feature",
  "specs/prompts/python-sdk-prompt-tags.feature",
  "specs/prompts/shorthand-prompt-label-syntax.feature",
  "specs/prompts/structured-outputs-streaming.feature",
  "specs/prompts/sync-auto-detect-variables.feature",
  "specs/prompts/template-logic-autocomplete.feature",
  "specs/python-sdk/async-experiment-parallelism.feature",
  "specs/python-sdk/experiment-print-summary.feature",
  "specs/python-sdk/prompt-tags.feature",
  "specs/rbac/fetch-org-role-permission-resolution.feature",
  "specs/rbac/lite-member-restrictions.feature",
  "specs/rbac/scoped-role-bindings.feature",
  "specs/scenarios/ai-create-modal.feature",
  "specs/scenarios/event-driven-execution-prep.feature",
  "specs/scenarios/internal-scenario-namespace.feature",
  "specs/scenarios/internal-set-namespace.feature",
  "specs/scenarios/model-params-error-feedback.feature",
  "specs/scenarios/scenario-api.feature",
  "specs/scenarios/scenario-bulk-actions.feature",
  "specs/scenarios/scenario-deferred-persistence.feature",
  "specs/scenarios/scenario-deletion.feature",
  "specs/scenarios/scenario-drawer-close-on-save.feature",
  "specs/scenarios/scenario-editor-new-agent-flow.feature",
  "specs/scenarios/scenario-editor.feature",
  "specs/scenarios/scenario-event-repository-tracing.feature",
  "specs/scenarios/scenario-execution.feature",
  "specs/scenarios/scenario-failure-handler.feature",
  "specs/scenarios/scenario-job-id-uniqueness.feature",
  "specs/scenarios/scenario-library.feature",
  "specs/scenarios/simulation-runner.feature",
  "specs/scenarios/stalled-scenario-runs.feature",
  "specs/settings/decompose-model-provider-form-hook.feature",
  "specs/settings/llm-model-cost-drawer-error-handling.feature",
  "specs/setup/docker-dev-worktree-isolation.feature",
  "specs/setup/simplified-setup.feature",
  "specs/skills/skills-testing.feature",
  "specs/suites/archived-scenario-exclusion.feature",
  "specs/suites/simulation-runs-page.feature",
  "specs/suites/suite-archiving.feature",
  "specs/suites/suite-run-dependency-refactor.feature",
  "specs/suites/suite-stale-prompt-references.feature",
  "specs/suites/suite-workflow.feature",
  "specs/traces/evaluation-history-grouping.feature",
  "specs/traces/explicit-application-origin.feature",
  "specs/traces/metadata-tag-filtering.feature",
  "specs/traces/pagination-controls.feature",
  "specs/traces/partial-trace-id-resolution.feature",
  "specs/traces/project-metadata-onboarding.feature",
  "specs/traces/saved-views.feature",
  "specs/traces/trace-export.feature",
  "specs/traces/trace-type-classification.feature",
  "specs/typescript-sdk/cli-docs.feature",
  "specs/typescript-sdk/cli-error-handling.feature",
  "specs/typescript-sdk/cli-prompt-tags.feature",
  "specs/typescript-sdk/experiment-print-summary.feature",
  "specs/typescript-sdk/prompt-tags.feature",
  "specs/variables-ui/prompt-textarea.feature",
  "specs/variables-ui/variable-insertion-menu.feature",
  "specs/variables-ui/variables-section.feature",
  "specs/workflows/studio-drawer-migration.feature",
  "specs/workflows/studio-evaluator-node-drawer.feature",
  "specs/workflows/studio-evaluator-sidebar.feature",
  "specs/workflows/studio-llm-node-drawer.feature",
  "specs/workflows/studio-local-state.feature",
  "specs/workflows/workflow-management.feature",
];

const TEST_FILE_RE = /\.test\.tsx?$/;
const FEATURE_FILE_RE = /\.feature$/;
const SKIP_DIR = new Set(["node_modules", ".next", "dist", "build"]);

const BOUND_TAGS = new Set(["@unit", "@integration", "@e2e", "@regression"]);

/**
 * Scenarios tagged `@unimplemented` have no expected test and are filtered
 * out of bound/unbound counting — they represent tracked gaps, not binding
 * failures. See dev/docs/TESTING_PHILOSOPHY.md.
 */
const UNIMPLEMENTED_TAG = "@unimplemented";

interface Scenario {
  title: string;
  tags: string[];
  line: number;
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

interface CollectedBinding {
  title: string;
  ref: BindingRef;
}

function parseFeature(absPath: string): Scenario[] {
  const raw = readFileSync(absPath, "utf8");
  const lines = raw.split("\n");
  const scenarios: Scenario[] = [];
  // Tags preceding the `Feature:` line apply to every scenario in the file
  // per Gherkin semantics (feature-level tagging).
  let featureTags: string[] = [];
  let featureSeen = false;
  let pendingTags: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed.startsWith("#") || trimmed === "") continue;

    if (trimmed.startsWith("@")) {
      const lineTags = trimmed.split(/\s+/).filter((t) => t.startsWith("@"));
      pendingTags = pendingTags.concat(lineTags);
      continue;
    }

    if (!featureSeen && trimmed.startsWith("Feature:")) {
      featureTags = pendingTags;
      pendingTags = [];
      featureSeen = true;
      continue;
    }

    const scenarioMatch = trimmed.match(/^Scenario(?:\s+Outline)?:\s*(.+)$/);
    if (scenarioMatch) {
      scenarios.push({
        title: scenarioMatch[1]!.trim(),
        tags: [...featureTags, ...pendingTags],
        line: i + 1,
      });
      pendingTags = [];
      continue;
    }

    if (!trimmed.startsWith("Given") && !trimmed.startsWith("When") &&
        !trimmed.startsWith("Then") && !trimmed.startsWith("And") &&
        !trimmed.startsWith("But") && !trimmed.startsWith("|")) {
      pendingTags = [];
    }
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
    if (SKIP_DIR.has(entry) || entry.startsWith(".")) continue;
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

function discoverFeatureFiles(): string[] {
  const files = walkFiles(SPECS_ROOT, (n) => FEATURE_FILE_RE.test(n));
  return files.map((f) => relative(REPO_ROOT, f)).sort();
}

// Non-backtracking: find `@scenario <title>` tokens, then verify proximity
// to an `it(` / `test(` call with a linear forward scan (see
// `isFollowedByTestCall`). Doing it all in the regex invites ReDoS.
const ANNOTATION_RE =
  /@scenario[ \t]+(?:"([^"\n]+)"|'([^'\n]+)'|([^\n*]+?))[ \t]*(?:\*\/|$)/gm;

function isFollowedByTestCall(src: string, start: number): boolean {
  const len = src.length;
  let i = start;
  while (i < len) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      if (close === -1) return false;
      i = close + 2;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return false;
      i = nl + 1;
      continue;
    }
    const rest = src.slice(i);
    const m = rest.match(/^(?:it|test)(?:\.[a-zA-Z]+)?\s*\(/);
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
    let m: RegExpExecArray | null;
    ANNOTATION_RE.lastIndex = 0;
    while ((m = ANNOTATION_RE.exec(src)) !== null) {
      const title = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      if (!title) continue;
      if (!isFollowedByTestCall(src, m.index + m[0].length)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      bindings.push({
        title,
        ref: { file: relative(REPO_ROOT, file), line },
      });
    }
  }

  return bindings;
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

function buildReport(
  featureRelPath: string,
  bindingsByTitle: Map<string, BindingRef[]>,
): Report {
  const absFeature = resolve(REPO_ROOT, featureRelPath);
  const allScenarios = parseFeature(absFeature);
  const scenarios = allScenarios.filter(
    (s) =>
      s.tags.some((t) => BOUND_TAGS.has(t)) &&
      !s.tags.includes(UNIMPLEMENTED_TAG)
  );

  const unbound: Scenario[] = [];
  const annotated: AnnotatedScenario[] = scenarios.map((s) => {
    const binds = bindingsByTitle.get(s.title) ?? [];
    if (binds.length === 0) unbound.push(s);
    return { ...s, bindings: binds };
  });

  return { feature: featureRelPath, scenarios: annotated, unbound };
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
  console.log(`  ${boundCount}/${total} scenarios bound`);

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
      `      Add: /** @scenario ${s.title} */ directly above an it(...) test that exercises this behavior`
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
    `  ${reports.length} file(s), ${totalBound}/${totalScenarios} bound, ${totalUnbound} unbound`
  );
  for (const r of reports) {
    console.log(`  · ${r.feature}  ${r.bound}/${r.total} bound, ${r.unbound} unbound`);
  }
  console.log(
    `\n  Shrink this list by binding scenarios, flagging @unimplemented, or removing stale scenarios. See dev/docs/TESTING_PHILOSOPHY.md.`
  );
}

function printUnknownAnnotations(unknown: UnknownAnnotation[]): void {
  if (unknown.length === 0) return;
  console.log(
    `\nAnnotations referencing unknown scenarios (typo? renamed scenario? stale binding?):`
  );
  for (const a of unknown) {
    console.log(`  ✗ @scenario ${a.title}`);
    console.log(`    ${a.ref.file}:${a.ref.line}`);
  }
}

function validateLegacyList(allFeatures: string[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of LEGACY_UNBOUND) {
    if (seen.has(entry)) {
      errors.push(`LEGACY_UNBOUND contains duplicate entry: ${entry}`);
      continue;
    }
    seen.add(entry);
    if (!allFeatures.includes(entry)) {
      const abs = resolve(REPO_ROOT, entry);
      if (!existsSync(abs)) {
        errors.push(
          `LEGACY_UNBOUND entry does not resolve to an existing .feature file: ${entry}`
        );
      } else {
        errors.push(
          `LEGACY_UNBOUND entry is not discovered under specs/: ${entry}`
        );
      }
    }
  }
  return errors;
}

function main(): void {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");

  const allFeatures = discoverFeatureFiles();
  const listErrors = validateLegacyList(allFeatures);

  const bindings = collectAllBindings(DEFAULT_TEST_ROOTS);
  const bindingsByTitle = indexByTitle(bindings);

  const allKnownTitles = new Set<string>();
  for (const f of allFeatures) {
    for (const s of parseFeature(resolve(REPO_ROOT, f))) {
      allKnownTitles.add(s.title);
    }
  }

  const unknownAnnotations: UnknownAnnotation[] = bindings
    .filter((b) => !allKnownTitles.has(b.title))
    .map((b) => ({ title: b.title, ref: b.ref }));

  const legacySet = new Set(LEGACY_UNBOUND);
  const enforced: Report[] = [];
  const legacy: LegacyReport[] = [];

  for (const f of allFeatures) {
    const report = buildReport(f, bindingsByTitle);
    if (legacySet.has(f)) {
      legacy.push(toLegacyReport(report));
    } else {
      enforced.push(report);
    }
  }

  // Legacy-list hygiene: every entry must still have at least one unbound
  // scenario. If a file is fully bound, it must be removed from the list.
  const staleLegacy = legacy.filter((r) => r.unbound === 0);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          enforced,
          legacy,
          unknownAnnotations,
          listErrors,
          staleLegacy: staleLegacy.map((r) => r.feature),
        },
        null,
        2
      )
    );
  } else {
    console.log("Feature-file parity check");
    console.log("=========================");
    console.log(
      `Enforced: ${enforced.length} file(s) · Legacy: ${legacy.length} file(s)`
    );

    for (const r of enforced) printEnforcedReport(r);
    printLegacySummary(legacy);
    printUnknownAnnotations(unknownAnnotations);
  }

  const enforcedUnbound = enforced.reduce((s, r) => s + r.unbound.length, 0);
  const hasFatal =
    enforcedUnbound > 0 ||
    unknownAnnotations.length > 0 ||
    listErrors.length > 0 ||
    staleLegacy.length > 0;

  if (hasFatal) {
    if (!asJson) {
      const parts: string[] = [];
      if (enforcedUnbound > 0) {
        parts.push(`${enforcedUnbound} unbound scenario(s) in enforced files`);
      }
      if (unknownAnnotations.length > 0) {
        parts.push(`${unknownAnnotations.length} unknown annotation(s)`);
      }
      if (staleLegacy.length > 0) {
        parts.push(
          `${staleLegacy.length} fully-bound file(s) still in LEGACY_UNBOUND — remove them from the list: ${staleLegacy
            .map((r) => r.feature)
            .join(", ")}`
        );
      }
      for (const err of listErrors) console.error(`LEGACY_UNBOUND error: ${err}`);
      console.error(
        `FAIL: ${parts.join(
          ", "
        )}. See spec-binding convention in dev/docs/TESTING_PHILOSOPHY.md.`
      );
    }
    process.exit(1);
  }

  if (!asJson) {
    const enforcedTotal = enforced.reduce(
      (s, r) => s + r.scenarios.length,
      0
    );
    const legacyUnbound = legacy.reduce((s, r) => s + r.unbound, 0);
    console.log(
      `\nOK: ${enforcedTotal} enforced scenario(s) bound across ${enforced.length} file(s).`
    );
    if (legacy.length > 0) {
      console.log(
        `    ${legacyUnbound} unbound scenario(s) tolerated in ${legacy.length} legacy file(s).`
      );
    }
  }
}

main();
