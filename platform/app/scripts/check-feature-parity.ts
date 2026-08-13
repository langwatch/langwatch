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
 * Polarity: enforce-all by default, and fail closed. Two ratcheted deny-lists
 * carry the migration debt, and both only ever shrink:
 *
 *   - `LEGACY_UNBOUND` — files with enforced-but-unbound scenarios.
 *   - `LEGACY_INERT`   — files that yield NO enforced scenario at all, because
 *                        nothing in them is tagged. Without this list such a
 *                        file reports `0/0 scenarios bound · ✓ all bound` and
 *                        passes, which is an assertion of coverage that does
 *                        not exist. Any file that becomes inert and is not on
 *                        the list is a hard failure.
 *
 * Shrinking both lists toward zero is the work tracked by #3338.
 *
 * Usage:
 *   pnpm check:feature-parity              # exit 1 if any enforced unbound
 *   pnpm check:feature-parity --json       # machine-readable report
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, "../../..");

/**
 * Every tree that holds `.feature` files.
 *
 * `sdks/typescript/specs` is here because leaving it out made the whole tree
 * INVISIBLE: its scenarios counted for nothing, and — worse — an `@scenario`
 * annotation in `sdks/typescript/src` (which IS scanned) could never resolve
 * against them, so binding one was reported as a typo. A spec tree the checker
 * cannot see is the same "0/0, all bound ✓" trap a `.feature` file with no tags
 * falls into, one directory up.
 */
const SPECS_ROOTS = [
  resolve(REPO_ROOT, "specs"),
  resolve(REPO_ROOT, "sdks/typescript/specs"),
] as const;

/**
 * Test roots scanned for `@scenario` bindings. Every `.test.ts` /
 * `.test.tsx` file under these roots is parsed for annotations. A binding
 * matches by scenario title, so proximity of the feature file to the test
 * is not required — any test in these roots can bind any scenario.
 */
const DEFAULT_TEST_ROOTS: string[] = [
  "platform/app/src",
  "platform/app/ee",
  "platform/app/scripts",
  "packages",
  "mcp/typescript/src",
  "sdks/typescript/src",
  "sdks/python/src",
  // The agent plugin is hand-authored manifests plus a bundle, so its only
  // tests are the ones that read those manifests and spawn that bundle. Without
  // this root, every scenario describing what the published plugin does could
  // only be @unimplemented.
  "plugins",
  // What we SHIP as instructions is behavior too: the skill sources and the
  // assistant's rules are tested here (and nowhere else), so scenarios about
  // what an instruction teaches can only bind from this root.
  "skills/_tests",
  // CI guards run under `node --test` from the workflow that uses them, not
  // vitest, and their tests live beside them. Without this root, a scenario
  // describing what a guard refuses could only ever be @unimplemented.
  ".github/scripts",
];

/**
 * Roots scanned for `.bats` shell tests. Shell-driven dev-environment
 * behavior (compose overrides, boxd fork orchestration) is tested with
 * bats, not vitest — without this scan path, scenarios that describe
 * shell behavior would have no way to satisfy parity and would be stuck
 * on `@unimplemented` forever. Bats bindings use the same `@scenario`
 * token, expressed as a hash-comment above an `@test "..." {` line —
 * blank lines and further comments may sit between the two.
 */
const DEFAULT_BATS_TEST_ROOTS: string[] = [
  "dev/scripts/__tests__",
  "platform/app/scripts/__tests__",
];

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
  // The README link checker, for the same reason: specs/ci/readme-link-check.feature
  // describes what CI asserts about the README, and only these Go tests assert it.
  "tools/linkcheck",
  // The CLI half of the same tool: the verdict-to-exit-code step is the part
  // CI gates on, so the "check fails" / "check passes" scenarios bind here.
  "cmd/linkcheck",
];

/**
 * Roots scanned for Python `test_*.py` files. Python-side scenarios
 * (langevals scorers) use the same `@scenario` token as TS/Go; binding
 * is satisfied when the next non-blank, non-comment line is a
 * `def test_...` function. Without this scan path, scenarios pinned to
 * langevals scorers would have no way to satisfy parity short of a
 * misleading TS stub.
 */
const DEFAULT_PYTHON_TEST_ROOTS: string[] = [
  "services/langevals",
  "sdks/python",
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
  // sdks/typescript/specs is absent from THIS list, but do not read that as
  // "the tree is fully resolved" — it is not. Adding the tree to SPECS_ROOTS
  // made it discoverable, and every scenario in it that carries a `@unit` /
  // `@integration` tag is bound. Most of its scenarios carry no tag at all and
  // so are invisible to this gate: `sdks/typescript/specs/cli/daemon.feature`,
  // for one, has 35 scenarios of which 2 are enforced and none are
  // @unimplemented. `LEGACY_INERT` below catches a file where that count falls
  // to zero; it does NOT catch a partially-tagged file like that one. Tagging
  // the remainder is still outstanding.
  //
  // The consolidated Langy/home corpus landed while feature parity was already
  // enforce-all, but its tests predate @scenario bindings. Keep the debt
  // explicit and file-scoped while #3338 drives this list back to empty; new
  // feature files remain enforced by default.
  "specs/home/home-views.feature",
  "specs/home/langy-briefing.feature",
  "specs/home/learning-resources.feature",
  "specs/langy/langy-api-key-provisioning.feature",
  "specs/langy/langy-capability-cards.feature",
  "specs/langy/langy-cli-tool-envelope.feature",
  "specs/langy/langy-context-system.feature",
  "specs/langy/langy-dual-stream.feature",
  "specs/langy/langy-feedback.feature",
  "specs/langy/langy-followup-suggestions.feature",
  "specs/langy/langy-frontend-realtime.feature",
  "specs/langy/langy-github-prs.feature",
  "specs/langy/langy-plan-progress.feature",
  "specs/langy/langy-projection-independent-reactions.feature",
  "specs/langy/langy-turn-recovery.feature",
];

/**
 * Feature files that contain scenarios but yield ZERO enforced ones, because
 * nothing in them is tagged `@unit` / `@integration` / `@e2e` / `@regression`.
 *
 * This is the gate's oldest blind spot. An untagged file is not "passing" — it
 * is unmeasured, and it reports itself as `0/0 scenarios bound · ✓ all bound`,
 * which reads exactly like a fully-covered file. Adding a fresh `.feature` with
 * twenty untagged scenarios used to be a silent no-op.
 *
 * The list turns that silence into a ratchet: the files below are the ones
 * already in that state when the floor was introduced, and they are tolerated.
 * Any OTHER file that yields no enforced scenario fails the check.
 *
 * A file whose scenarios are all `@unimplemented` also lands here — tags say
 * "tracked gap", and that is a claim worth making explicitly rather than by
 * omission.
 *
 * Direction: drive this list to empty by tagging the scenarios that describe
 * behaviour we actually test, marking @unimplemented the ones we do not, and
 * deleting the ones that no longer describe anything.
 *
 * Invariants (enforced below):
 *   - Every path must resolve to a discovered `.feature` file.
 *   - Every entry must still be inert. A file that has since gained an
 *     enforced scenario must be removed — that is the ratchet clicking.
 */
const LEGACY_INERT: string[] = [
  "specs/agents/create-workflow-agent.feature",
  "specs/agents/workflow-agent-editor.feature",
  "specs/ai-gateway/azure-endpoint-from-api-base.feature",
  "specs/ai-gateway/budgets-principal-cascade.feature",
  "specs/ai-gateway/cache-control-rules.feature",
  "specs/ai-gateway/caching-passthrough.feature",
  "specs/ai-gateway/cli-integrations.feature",
  "specs/ai-gateway/cli-virtualkeys.feature",
  "specs/ai-gateway/custom-provider-base-url.feature",
  "specs/ai-gateway/epic.feature",
  "specs/ai-gateway/governance/activity-monitor.feature",
  "specs/ai-gateway/governance/admin-oversight.feature",
  "specs/ai-gateway/governance/anomaly-detection.feature",
  "specs/ai-gateway/governance/anomaly-rules.feature",
  "specs/ai-gateway/governance/architecture-invariants.feature",
  "specs/ai-gateway/governance/birds-eye-dashboard-v2.feature",
  "specs/ai-gateway/governance/c3-alert-dispatch.feature",
  "specs/ai-gateway/governance/cli-402-license-gate.feature",
  "specs/ai-gateway/governance/cli-deep-links.feature",
  "specs/ai-gateway/governance/cli-ingest-debug.feature",
  "specs/ai-gateway/governance/cli-tool-mode-policy.feature",
  "specs/ai-gateway/governance/compliance-baseline.feature",
  "specs/ai-gateway/governance/event-log-durability.feature",
  "specs/ai-gateway/governance/feature-flag-gating.feature",
  "specs/ai-gateway/governance/folds.feature",
  "specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature",
  "specs/ai-gateway/governance/governance-home-routing.feature",
  "specs/ai-gateway/governance/guardrails-project-scope.feature",
  "specs/ai-gateway/governance/ingestion-attribution.feature",
  "specs/ai-gateway/governance/ingestion-sources.feature",
  "specs/ai-gateway/governance/me-usage-rest-api.feature",
  "specs/ai-gateway/governance/my-settings.feature",
  "specs/ai-gateway/governance/no-spy-mode.feature",
  "specs/ai-gateway/governance/persona-aware-chrome.feature",
  "specs/ai-gateway/governance/persona-home-content.feature",
  "specs/ai-gateway/governance/personal-keys.feature",
  "specs/ai-gateway/governance/personal-project-ingest-via-template.feature",
  "specs/ai-gateway/governance/personal-workspace-features.feature",
  "specs/ai-gateway/governance/receiver-auth-rate-limit.feature",
  "specs/ai-gateway/governance/receiver-shapes.feature",
  "specs/ai-gateway/governance/routing-policy-aliases-and-rules.feature",
  "specs/ai-gateway/governance/routing-policy-scope-cascade.feature",
  "specs/ai-gateway/governance/self-hosted-setup.feature",
  "specs/ai-gateway/governance/sessions-and-devices.feature",
  "specs/ai-gateway/governance/siem-export.feature",
  "specs/ai-gateway/governance/template-cross-bind-guard.feature",
  "specs/ai-gateway/governance/template-ottl-authoring.feature",
  "specs/ai-gateway/governance/template-ottl-principal-guard.feature",
  "specs/ai-gateway/governance/vk-config-bundle.feature",
  "specs/ai-gateway/governance/vk-personal-scope.feature",
  "specs/ai-gateway/governance/vk-scope-inheritance.feature",
  "specs/ai-gateway/guardrails.feature",
  "specs/ai-gateway/health-checks.feature",
  "specs/ai-gateway/license-gate-governance.feature",
  "specs/ai-gateway/payload-capture.feature",
  "specs/ai-gateway/prometheus-metrics.feature",
  "specs/ai-gateway/rate-limits.feature",
  "specs/ai-gateway/rbac-legacy-admin-fallback.feature",
  "specs/ai-gateway/self-hosting/gateway-finds-its-control-plane.feature",
  "specs/ai-gateway/self-hosting/personal-keys-deployment.feature",
  "specs/ai-gateway/semantic-caching.feature",
  "specs/ai-gateway/trace-propagation.feature",
  "specs/ai-gateway/wrapper-e2e/claude.feature",
  "specs/ai-gateway/wrapper-e2e/codex.feature",
  "specs/ai-gateway/wrapper-e2e/cursor.feature",
  "specs/ai-gateway/wrapper-e2e/gemini.feature",
  "specs/ai-gateway/wrapper-e2e/opencode.feature",
  "specs/ai-governance/cli-wrappers/logout.feature",
  "specs/ai-governance/cli-wrappers/request-increase.feature",
  "specs/ai-governance/cli-wrappers/wrap-login-routing.feature",
  "specs/ai-governance/dogfood-seed/scope-runner.feature",
  "specs/ai-governance/ingestion-sources/claude-code-otlp.feature",
  "specs/ai-governance/ingestion-sources/native-receiver-lift.feature",
  "specs/ai-governance/no-spy-mode/no-spy-mode.feature",
  "specs/ai-governance/personal-portal/coding-assistant-tile.feature",
  "specs/ai-governance/personal-portal/external-tool-tile.feature",
  "specs/ai-governance/personal-portal/model-provider-tile.feature",
  "specs/ai-governance/personal-portal/portal-grid.feature",
  "specs/ai-governance/personal-portal/tool-catalog-scoping.feature",
  "specs/ai-governance/personal-portal/tool-catalog-vk-bridge.feature",
  "specs/ai-governance/puller-framework/copilot-studio-reference.feature",
  "specs/ai-governance/puller-framework/event-sourced-process-scheduling.feature",
  "specs/ai-governance/puller-framework/http-custom-byo-admin-ui.feature",
  "specs/ai-governance/puller-framework/http-polling.feature",
  "specs/ai-governance/puller-framework/puller-adapter-contract.feature",
  "specs/ai-governance/puller-framework/s3-polling.feature",
  "specs/ai-governance/sessions/admin-max-ttl.feature",
  "specs/ai-governance/sessions/personal-sessions.feature",
  "specs/ai-governance/sessions/sessions-inventory.feature",
  "specs/analytics/dashboard-rest-api.feature",
  "specs/analytics/posthog-cost-control.feature",
  "specs/audit-log/audit-log.feature",
  "specs/auth/auth-signin-flows.feature",
  "specs/auth/dev-port-origin-alignment.feature",
  "specs/auth/diagnostic-logging-on-auth-failure.feature",
  "specs/auth/impersonation-banner.feature",
  "specs/auth/sign-in-failure-messages.feature",
  "specs/auth/sso-orphan-user-linking.feature",
  "specs/auth/sso-wrong-provider-recovery.feature",
  "specs/automations/dispatch-timing.feature",
  "specs/automations/notification-templates.feature",
  "specs/automations/spam-prevention.feature",
  "specs/automations/webhook-http-action.feature",
  "specs/batch-evaluation-results/experiment-cost-folding.feature",
  "specs/batch-evaluation-results/run-comparison.feature",
  "specs/batch-evaluation-results/target-metadata-api.feature",
  "specs/ci/migration-order.feature",
  "specs/ci/no-committed-screenshots.feature",
  "specs/ci/no-docker-integration-tests.feature",
  "specs/ci/pr-impact-map.feature",
  "specs/claude/drive-pr.feature",
  "specs/claude/telemetry-turn-bounding.feature",
  "specs/coding-agent/personal-usage.feature",
  "specs/components/code-block-editor.feature",
  "specs/data-retention/data-size-metering.feature",
  "specs/data-retention/ingestion-stamping.feature",
  "specs/data-retention/monitoring.feature",
  "specs/data-retention/plan-gated-retention-menu.feature",
  "specs/data-retention/retention-policy-configuration.feature",
  "specs/data-retention/retroactive-update.feature",
  "specs/data-retention/trace-pinning.feature",
  "specs/data-retention/ttl-activation.feature",
  "specs/data-retention/visibility-window-teaser-redaction.feature",
  "specs/dependencies/supply-chain-age-gates.feature",
  "specs/evaluations/evaluation-payload-offload.feature",
  "specs/evaluations/experiments-online-evaluations-separation.feature",
  "specs/evaluators/create-workflow-evaluator.feature",
  "specs/evaluators/evaluator-cli.feature",
  "specs/evaluators/evaluator-error-propagation.feature",
  "specs/evaluators/satisfaction-score-migration.feature",
  "specs/evaluators/thread-eval-skips-without-thread-id.feature",
  "specs/evaluators/workflow-evaluator-editor.feature",
  "specs/event-sourcing/deduplication-strategy.feature",
  "specs/event-sourcing/dispatch-error-contract.feature",
  "specs/event-sourcing/fold-projection.feature",
  "specs/event-sourcing/global-projections.feature",
  "specs/event-sourcing/map-projection.feature",
  "specs/event-sourcing/oversized-attribute-value-preview.feature",
  "specs/event-sourcing/payload-envelope.feature",
  "specs/event-sourcing/pipeline-model.feature",
  "specs/event-sourcing/process-roles.feature",
  "specs/event-sourcing/redis-fold-cache.feature",
  "specs/event-sourcing/work-conserving-fair-dispatch.feature",
  "specs/experiments-v3/autosave-status.feature",
  "specs/experiments-v3/dataset-inline-editing.feature",
  "specs/experiments-v3/evaluation-creation-entrypoints.feature",
  "specs/experiments-v3/evaluation-execution.feature",
  "specs/experiments-v3/evaluator-configuration.feature",
  "specs/experiments-v3/evaluator-mappings.feature",
  "specs/experiments-v3/execution-controls.feature",
  "specs/experiments-v3/http-agent-support.feature",
  "specs/experiments-v3/per-dataset-mappings.feature",
  "specs/experiments-v3/runner-configuration.feature",
  "specs/experiments-v3/table-display.feature",
  "specs/experiments-v3/undo-redo.feature",
  "specs/features/agent-cli.feature",
  "specs/features/analytics-cli.feature",
  "specs/features/annotation-cli.feature",
  "specs/features/dashboard-cli.feature",
  "specs/features/dataset-python-sdk.feature",
  "specs/features/devtools/issue-creation-skill.feature",
  "specs/features/devtools/orchestrator-bug-fix-workflow.feature",
  "specs/features/devtools/worktree-creation.feature",
  "specs/features/evaluation-cli.feature",
  "specs/features/graph-cli.feature",
  "specs/features/model-provider-cli.feature",
  "specs/features/monitor-cli.feature",
  "specs/features/onboarding/primary-use-setting.feature",
  "specs/features/prompt-versions-cli.feature",
  "specs/features/scenario-cli.feature",
  "specs/features/secret-cli.feature",
  "specs/features/simulation-runs-cli.feature",
  "specs/features/suite-cli.feature",
  "specs/features/suites/collapsible-suite-sidebar.feature",
  "specs/features/suites/footer-to-header-migration.feature",
  "specs/features/suites/inline-add-target-and-scenario-buttons.feature",
  "specs/features/suites/sidebar-summary-status.feature",
  "specs/features/suites/simulation-run-status-consistency.feature",
  "specs/features/suites/suite-run-confirmation-modal.feature",
  "specs/features/suites/suite-sidebar-status-summary.feature",
  "specs/features/suites/suite-url-nesting.feature",
  "specs/features/suites/suite-url-routing.feature",
  "specs/features/suites/trace-role-cost-accumulation.feature",
  "specs/features/suites/unified-run-view-layout.feature",
  "specs/features/suites/unified-sidebar-list-items.feature",
  "specs/features/tag-management.feature",
  "specs/features/trace-cli.feature",
  "specs/features/trigger-cli.feature",
  "specs/features/workflow-cli.feature",
  "specs/home/onboarding-progress-ui.feature",
  "specs/home/voice-agents-home-banner.feature",
  "specs/langy/langy-agent-service-conventions.feature",
  "specs/langy/langy-baseline.feature",
  "specs/langy/langy-card-taxonomy.feature",
  "specs/langy/langy-choice-questions.feature",
  "specs/langy/langy-command-bar-activation.feature",
  "specs/langy/langy-composer-feedback-and-cards.feature",
  "specs/langy/langy-context-awareness.feature",
  "specs/langy/langy-conversation-title.feature",
  "specs/langy/langy-derived-cards.feature",
  "specs/langy/langy-dogfood-scenarios.feature",
  "specs/langy/langy-empty-state-suggestions.feature",
  "specs/langy/langy-event-sourced-conversations.feature",
  "specs/langy/langy-native-skills.feature",
  "specs/langy/langy-panel-fold-motion.feature",
  "specs/langy/langy-peek-dock.feature",
  "specs/langy/langy-selfhost-install.feature",
  "specs/langy/langy-session-key-lifecycle.feature",
  "specs/langy/langy-session-key.feature",
  "specs/langy/langy-shutdown-handoff.feature",
  "specs/langy/langy-workbench-sidebar.feature",
  "specs/langy/langy-worker-isolation.feature",
  "specs/licensing/billing-meter-dispatch.feature",
  "specs/licensing/dual-pricing-model.feature",
  "specs/licensing/enforcement-hono-api.feature",
  "specs/licensing/license-activation-ui.feature",
  "specs/licensing/license-lifecycle-e2e.feature",
  "specs/licensing/license-page-styling.feature",
  "specs/licensing/license-status-ui.feature",
  "specs/licensing/notification-coverage-gaps.feature",
  "specs/licensing/resource-limit-notifications.feature",
  "specs/licensing/usage-page-navigation.feature",
  "specs/mcp-server/analytics-tool.feature",
  "specs/mcp-server/api-key-tools.feature",
  "specs/mcp-server/experiment-results-tool.feature",
  "specs/mcp-server/project-api-key-tools.feature",
  "specs/mcp-server/project-tools.feature",
  "specs/mcp-server/prompt-tools.feature",
  "specs/mcp-server/scenario-tool-formatters.feature",
  "specs/migration/vite-migration.feature",
  "specs/model-config/anthropic-empty-content.feature",
  "specs/model-config/litellm-reasoning-params.feature",
  "specs/model-config/model-parameter-display.feature",
  "specs/model-config/model-selector-ux.feature",
  "specs/model-config/unified-reasoning-ui.feature",
  "specs/model-providers/custom-model-max-tokens.feature",
  "specs/model-providers/default-provider.feature",
  "specs/model-providers/provider-list.feature",
  "specs/monitors/evaluation-trigger-skips-derived-and-stale-traces.feature",
  "specs/monitors/guardrails-api-compatibility.feature",
  "specs/monitors/monitor-execution-backend.feature",
  "specs/monitors/monitor-trace-mappings.feature",
  "specs/monitors/new-evaluation-menu.feature",
  "specs/monitors/online-evaluation-drawer-flow.feature",
  "specs/monitors/online-evaluation-drawer.feature",
  "specs/monitors/pending-mappings-validation.feature",
  "specs/monitors/replicate-monitor-to-project.feature",
  "specs/monitors/workflow-evaluator-checktype.feature",
  "specs/monitors/workflow-evaluator-mappings.feature",
  "specs/navigation/child-drawer-nesting.feature",
  "specs/navigation/home-navigation.feature",
  "specs/nlp-go/dataset-block.feature",
  "specs/nlp-go/http-block.feature",
  "specs/nlp-go/proxy.feature",
  "specs/nlp-go/python-removal.feature",
  "specs/nlp-go/remove-execute-evaluation.feature",
  "specs/nlp-go/telemetry.feature",
  "specs/nlp-go/topic-clustering.feature",
  "specs/nlp-go/tracing-parity.feature",
  "specs/npx-installer/01-bootstrap.feature",
  "specs/npx-installer/02-predeps.feature",
  "specs/npx-installer/03-services.feature",
  "specs/npx-installer/04-validation.feature",
  "specs/npx-installer/05-publish.feature",
  "specs/npx-installer/06-langy.feature",
  "specs/observability/browser-rum-trace-correlation.feature",
  "specs/observability/process-substrate-alerting.feature",
  "specs/ops/clickhouse-backup-metrics.feature",
  "specs/ops/dashboard-latency.feature",
  "specs/ops/dejaview-impersonation-access.feature",
  "specs/ops/internal-feature-flags.feature",
  "specs/ops/local-observability-stack.feature",
  "specs/ops/production-bundle-integrity.feature",
  "specs/otlp/canonical-log-ingestion.feature",
  "specs/projects/create-project-drawer.feature",
  "specs/projects/project-list-refresh.feature",
  "specs/prompts/custom-prompt-tags.feature",
  "specs/prompts/liquid-template-support.feature",
  "specs/prompts/open-existing-prompt-from-trace.feature",
  "specs/prompts/open-trace-in-playground.feature",
  "specs/prompts/prompt-selection-drawer.feature",
  "specs/prompts/structured-outputs-streaming.feature",
  "specs/prompts/unified-defaults.feature",
  "specs/python-sdk/async-experiment-parallelism.feature",
  "specs/python-sdk/experiment-print-summary.feature",
  "specs/rbac/fetch-org-role-permission-resolution.feature",
  "specs/scenarios/ai-create-modal.feature",
  "specs/scenarios/internal-scenario-namespace.feature",
  "specs/scenarios/internal-set-namespace.feature",
  "specs/scenarios/provider-setup-link-from-warnings.feature",
  "specs/scenarios/scenario-api.feature",
  "specs/scenarios/scenario-bulk-actions.feature",
  "specs/scenarios/scenario-deferred-persistence.feature",
  "specs/scenarios/scenario-deletion.feature",
  "specs/scenarios/scenario-drawer-close-on-save.feature",
  "specs/scenarios/scenario-editor-new-agent-flow.feature",
  "specs/scenarios/scenario-editor.feature",
  "specs/scenarios/scenario-execution.feature",
  "specs/scenarios/scenario-library.feature",
  "specs/secrets/secrets-manager.feature",
  // Helm chart behaviour, verified by charts/langwatch/tests/e2e-overlays.sh.
  // The checker now scans that directory (DEFAULT_SHELL_TEST_ROOTS), so these
  // are bindable: annotate the suite's test functions with `# @scenario` and
  // drop the file from this list. Until someone does, the scenarios are all
  // @e2e @unimplemented and the file yields nothing to enforce.
  "specs/security/helm-strict-admission.feature",
  "specs/security/ingress-internal-path-block.feature",
  "specs/security/org-level-tenancy-enforcement.feature",
  "specs/security/tenant-aware-egress-isolation.feature",
  "specs/server/metrics-collection.feature",
  "specs/server/spa-fallback.feature",
  "specs/settings/decompose-model-provider-form-hook.feature",
  "specs/settings/settings-table-responsiveness.feature",
  "specs/setup/docker-dev-worktree-isolation.feature",
  "specs/setup/simplified-setup.feature",
  "specs/skills/agent-insight-skills.feature",
  "specs/skills/docs-skills-directory.feature",
  "specs/skills/empty-state-skill-setup.feature",
  "specs/skills/onboarding-skills-architecture.feature",
  "specs/skills/platform-integration.feature",
  "specs/skills/prompt-compiler.feature",
  "specs/skills/skills-testing.feature",
  "specs/studio/nlpgo-true-root-span-without-traceparent.feature",
  "specs/suites/simulations-performance.feature",
  "specs/suites/voice-agents-callout.feature",
  "specs/topic-clustering/event-sourced-scheduling.feature",
  "specs/topic-clustering/run-history.feature",
  "specs/topic-clustering/topics-source-of-truth.feature",
  "specs/trace-drawer/attribute-table.feature",
  "specs/trace-drawer/eval-chips-in-header.feature",
  "specs/trace-drawer/playground-affordance.feature",
  "specs/trace-processing/oversized-trace-lighter-processing.feature",
  "specs/trace-processing/sdk-timing-and-metrics-canonicalisation.feature",
  "specs/traces-v2/accessibility.feature",
  "specs/traces-v2/attribute-value-readability.feature",
  "specs/traces-v2/column-configuration.feature",
  "specs/traces-v2/conditional-formatting.feature",
  "specs/traces-v2/conversation-context-turn-counts.feature",
  "specs/traces-v2/conversation-message-expand.feature",
  "specs/traces-v2/editable-trace-name-alignment.feature",
  "specs/traces-v2/facet-perspectives.feature",
  "specs/traces-v2/flame-graph.feature",
  "specs/traces-v2/grouping-engine.feature",
  "specs/traces-v2/io-pretty-markdown.feature",
  "specs/traces-v2/lens-preset-groups.feature",
  "specs/traces-v2/light-mode-contrast.feature",
  "specs/traces-v2/live-tail.feature",
  "specs/traces-v2/metadata-facet.feature",
  "specs/traces-v2/metrics.feature",
  "specs/traces-v2/model-chip-interactive-card.feature",
  "specs/traces-v2/multiplayer-presence.feature",
  "specs/traces-v2/onboarding-empty-state.feature",
  "specs/traces-v2/origin-badge-filter.feature",
  "specs/traces-v2/prompt-facets.feature",
  "specs/traces-v2/prompt-integration.feature",
  "specs/traces-v2/skill-invocation-highlight.feature",
  "specs/traces-v2/span-list.feature",
  "specs/traces-v2/span-reference-jump-to-trace.feature",
  "specs/traces-v2/span-view.feature",
  "specs/traces-v2/tour-visibility-and-persistence.feature",
  "specs/traces-v2/trace-drawer-panes.feature",
  "specs/traces-v2/trace-drawer-shell.feature",
  "specs/traces-v2/trace-header-full-content-resolution.feature",
  "specs/traces-v2/trace-peek.feature",
  "specs/traces-v2/trace-table.feature",
  "specs/traces-v2/trace-view.feature",
  "specs/traces-v2/view-analytics.feature",
  "specs/traces-v2/view-system.feature",
  "specs/traces-v2/visualizations.feature",
  "specs/traces/evaluation-history-grouping.feature",
  "specs/traces/openinference-token-ingest.feature",
  "specs/traces/pagination-controls.feature",
  "specs/traces/rag-contexts-read-deserialization.feature",
  "specs/traces/rest-collector-span-dedup.feature",
  "specs/traces/span-attribute-unicode-sanitisation.feature",
  "specs/traces/trace-export.feature",
  "specs/traces/trace-io-extraction.feature",
  "specs/traces/vertex-adk-canonicalisation.feature",
  "specs/triggers/event-sourced-graph-triggers.feature",
  "specs/typescript-sdk/cli-docs.feature",
  "specs/typescript-sdk/cli-error-handling.feature",
  "specs/typescript-sdk/cli-projects-api-keys.feature",
  "specs/typescript-sdk/prompt-tags.feature",
  "specs/variables-ui/prompt-editor-drawer-mappings.feature",
  "specs/workflows/studio-drawer-migration.feature",
  "specs/workflows/studio-evaluator-node-drawer.feature",
  "specs/workflows/studio-evaluator-sidebar.feature",
  "specs/workflows/studio-llm-node-drawer.feature",
  "specs/workflows/studio-local-state.feature",
  "specs/workflows/studio-usage-limits.feature",
  "specs/workflows/workflow-management.feature",
];

const TEST_FILE_RE = /\.test\.tsx?$/;
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
  /** Every scenario the file declares, tagged or not. */
  totalScenarios: number;
  /** Of those, how many are explicitly parked as `@unimplemented`. */
  unimplementedScenarios: number;
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

    if (
      !trimmed.startsWith("Given") &&
      !trimmed.startsWith("When") &&
      !trimmed.startsWith("Then") &&
      !trimmed.startsWith("And") &&
      !trimmed.startsWith("But") &&
      !trimmed.startsWith("|")
    ) {
      pendingTags = [];
    }
  }

  return scenarios;
}

function walkFiles(
  root: string,
  predicate: (name: string) => boolean,
): string[] {
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

/**
 * A configured root that is missing is a CONFIGURATION failure, not an empty
 * tree. Skipping it silently is how a renamed or moved spec directory reports
 * every scenario in it as bound: the files simply stop being discovered, and
 * the check goes green having measured nothing. Fail closed instead — the tree
 * is either there or the check refuses to run.
 */
export function discoverFeatureFiles(
  roots: readonly string[] = SPECS_ROOTS,
): string[] {
  const files = roots.flatMap((root) => {
    if (!existsSync(root)) {
      throw new Error(
        `Configured specs root does not exist: ${root}. ` +
          `Fix SPECS_ROOTS in scripts/check-feature-parity.ts, or restore the tree — ` +
          `a missing root would silently report every scenario under it as bound.`,
      );
    }
    if (!statSync(root).isDirectory()) {
      throw new Error(
        `Configured specs root is not a directory: ${root}. ` +
          `Fix SPECS_ROOTS in scripts/check-feature-parity.ts.`,
      );
    }
    return walkFiles(root, (n) => FEATURE_FILE_RE.test(n));
  });
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
    files.push(
      ...walkFiles(resolve(REPO_ROOT, r), (n) => TEST_FILE_RE.test(n)),
    );
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

/**
 * Bats binding form (line-oriented, comment-prefixed):
 *
 *   # @scenario "Stale localhost NEXTAUTH_URL is rewritten to the fork's proxy URL"
 *   @test "boxd_rewrite_env: rewrites NEXTAUTH_URL allowlist key" {
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
const BATS_ANNOTATION_RE =
  /^[ \t]*#[ \t]*@scenario[ \t]+(?:"([^"\r\n]+)"|'([^'\r\n]+)')[ \t\r]*$/;

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
const GO_SUBTEST_CLOSURE_RE =
  /^func\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s+\*testing\.T\s*\)\s*\{/;

/**
 * Longest prefix of a `.Run(` call the scan will read before giving up. The
 * first argument plus its comma is a few dozen characters even when the call
 * is spread over several lines; the cap exists only so a truncated or
 * malformed file cannot turn the scan into a walk to EOF.
 */
const GO_SUBTEST_SCAN_BUDGET = 4096;

/**
 * Advance past Go whitespace and comments, returning the index of the next
 * significant character, or `-1` if `limit` is reached first. Linear: every
 * character is visited at most once, no backtracking.
 */
function skipGoSpaceAndComments(
  src: string,
  start: number,
  limit: number,
): number {
  let i = start;
  while (i < limit) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      if (close === -1 || close + 2 > limit) return -1;
      i = close + 2;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1 || nl + 1 > limit) return -1;
      i = nl + 1;
      continue;
    }
    return i;
  }
  return -1;
}

/**
 * Is `rest` the start of a `t.Run("name", func(t *testing.T) { … }` subtest
 * declaration?
 *
 * The subtest name may be a quoted literal, a raw (backtick) literal, or an
 * arbitrary expression (`tc.name`, `fmt.Sprintf("%s/%s", a, b)`), and gofmt
 * does NOT collapse the call onto one line — it preserves whatever the author
 * wrote, so the very common
 *
 *   t.Run(
 *     "a long subtest name",
 *     func(t *testing.T) {
 *
 * has to bind too. A regex that spans the newline would either backtrack
 * across the rest of the file on every non-match (`[\s\S]*?`) or, bounded to
 * one line (`[^\n]*?`), silently reject the form above. So the first argument
 * is walked forward instead, character by character and once each: string,
 * raw-string and rune literals are skipped whole so a comma inside them is not
 * read as the argument separator, bracket depth is tracked for the same reason,
 * and the walk stops at the first top-level comma. What follows that comma must
 * be the `*testing.T` closure.
 */
function isGoSubtestDeclaration(rest: string): boolean {
  const head = rest.match(GO_SUBTEST_HEAD_RE);
  if (!head) return false;

  const headLength = head[0]!.length;
  const limit = Math.min(rest.length, headLength + GO_SUBTEST_SCAN_BUDGET);
  let depth = 0;
  let i = headLength;
  let commaAt = -1;

  while (i < limit) {
    const ch = rest[i];

    if (ch === '"' || ch === "'") {
      // Interpreted string / rune literal: backslash escapes, never spans a line.
      const quote = ch;
      i++;
      let closed = false;
      while (i < limit) {
        const c = rest[i];
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === "\n") return false;
        i++;
        if (c === quote) {
          closed = true;
          break;
        }
      }
      if (!closed) return false;
      continue;
    }

    if (ch === "`") {
      // Raw string literal: no escapes, may span lines.
      const close = rest.indexOf("`", i + 1);
      if (close === -1 || close >= limit) return false;
      i = close + 1;
      continue;
    }

    if (ch === "/" && (rest[i + 1] === "/" || rest[i + 1] === "*")) {
      const next = skipGoSpaceAndComments(rest, i, limit);
      if (next === -1) return false;
      i = next;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      i++;
      continue;
    }

    if (ch === ")" || ch === "]" || ch === "}") {
      // The call closed before any top-level comma: `t.Run(name)` is not a subtest.
      if (depth === 0) return false;
      depth--;
      i++;
      continue;
    }

    if (ch === "," && depth === 0) {
      commaAt = i;
      break;
    }

    i++;
  }

  if (commaAt === -1) return false;

  const closureAt = skipGoSpaceAndComments(rest, commaAt + 1, limit);
  if (closureAt === -1) return false;
  return GO_SUBTEST_CLOSURE_RE.test(rest.slice(closureAt));
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
    files.push(
      ...walkFiles(resolve(REPO_ROOT, r), (n) => GO_TEST_FILE_RE.test(n)),
    );
  }

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    ANNOTATION_RE.lastIndex = 0;
    while ((m = ANNOTATION_RE.exec(src)) !== null) {
      const title = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      if (!title) continue;
      if (!isFollowedByGoTestFunc(src, m.index + m[0].length)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      bindings.push({
        title,
        ref: { file: relative(REPO_ROOT, file), line },
      });
    }
  }

  return bindings;
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
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
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
      // Skip Python decorators, including parenthesised multi-line forms
      // like @pytest.mark.parametrize("a,b", [...]) that span many lines.
      let j = i + 1;
      while (j < len && src[j] !== "\n" && src[j] !== "(") j++;
      if (j < len && src[j] === "(") {
        let depth = 1;
        j++;
        while (j < len && depth > 0) {
          const c = src[j];
          if (c === "(") depth++;
          else if (c === ")") depth--;
          j++;
        }
      }
      while (j < len && src[j] !== "\n") j++;
      i = j + 1;
      continue;
    }
    const rest = src.slice(i);
    return /^(?:async\s+)?def\s+test_[A-Za-z0-9_]*\s*\(/.test(rest);
  }
  return false;
}

const PYTHON_HASH_ANNOTATION_RE =
  /^[ \t]*#[ \t]*@scenario[ \t]+(?:"([^"\r\n]+)"|'([^'\r\n]+)')[ \t\r]*$/;

function collectPythonBindings(testRoots: string[]): CollectedBinding[] {
  const bindings: CollectedBinding[] = [];
  const files: string[] = [];
  for (const r of testRoots) {
    files.push(
      ...walkFiles(resolve(REPO_ROOT, r), (n) => PYTHON_TEST_FILE_RE.test(n)),
    );
  }

  for (const file of files) {
    const src = readFileSync(file, "utf8");

    // Block-comment form (mirrors TS / Go).
    let m: RegExpExecArray | null;
    ANNOTATION_RE.lastIndex = 0;
    while ((m = ANNOTATION_RE.exec(src)) !== null) {
      const title = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      if (!title) continue;
      if (!isFollowedByPythonTestFunc(src, m.index + m[0].length)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      bindings.push({
        title,
        ref: { file: relative(REPO_ROOT, file), line },
      });
    }

    // Hash-comment form (mirrors Bats).
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const hm = line.match(PYTHON_HASH_ANNOTATION_RE);
      if (!hm) continue;
      const title = (hm[1] ?? hm[2] ?? "").trim();
      if (!title) continue;
      // Use the same proximity check as the block form. Walk from the
      // start of the next line.
      const lineStartOffset = lines
        .slice(0, i + 1)
        .reduce((acc, l) => acc + l.length + 1, 0);
      if (!isFollowedByPythonTestFunc(src, lineStartOffset)) continue;
      bindings.push({
        title,
        ref: { file: relative(REPO_ROOT, file), line: i + 1 },
      });
    }
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

function buildReport(
  featureRelPath: string,
  bindingsByTitle: Map<string, BindingRef[]>,
): Report {
  const absFeature = resolve(REPO_ROOT, featureRelPath);
  const allScenarios = parseFeature(absFeature);
  const scenarios = allScenarios.filter(
    (s) =>
      s.tags.some((t) => BOUND_TAGS.has(t)) &&
      !s.tags.includes(UNIMPLEMENTED_TAG),
  );

  const unbound: Scenario[] = [];
  const annotated: AnnotatedScenario[] = scenarios.map((s) => {
    const binds = bindingsByTitle.get(s.title) ?? [];
    if (binds.length === 0) unbound.push(s);
    return { ...s, bindings: binds };
  });

  return {
    feature: featureRelPath,
    scenarios: annotated,
    unbound,
    totalScenarios: allScenarios.length,
    unimplementedScenarios: allScenarios.filter((s) =>
      s.tags.includes(UNIMPLEMENTED_TAG),
    ).length,
  };
}

/**
 * The floor under the `0/0 · ✓ all bound` trap: a file that declares scenarios
 * and enforces none of them. Callers decide whether a given file is tolerated
 * (`LEGACY_INERT`) or fatal.
 */
export function isInert(
  r: Pick<Report, "scenarios" | "totalScenarios">,
): boolean {
  return r.totalScenarios > 0 && r.scenarios.length === 0;
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

  console.log(`  ${boundCount}/${total} scenarios bound`);

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
    console.log(
      `  · ${r.feature}  ${r.bound}/${r.total} bound, ${r.unbound} unbound`,
    );
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
  console.log(`\nInert (no enforced scenarios — tolerated via LEGACY_INERT):`);
  console.log(
    `  ${reports.length} file(s) hold ${invisible} scenario(s) this check cannot see` +
      (parked > 0 ? ` (${parked} of them parked as @unimplemented).` : "."),
  );
  console.log(
    `  Tag them @unit/@integration to measure them, or @unimplemented to declare the gap. See dev/docs/TESTING_PHILOSOPHY.md.`,
  );
}

function printNewInert(reports: InertReport[]): void {
  if (reports.length === 0) return;
  console.log(`\nFeature files that enforce no scenario at all:`);
  for (const r of reports) {
    console.log(`  ✗ ${r.feature}`);
    console.log(`      ${describeInert(r)}`);
    console.log(
      `      Tag the scenarios @unit / @integration / @e2e / @regression and bind them, or add this file to LEGACY_INERT with a reason.`,
    );
  }
}

function printUnknownAnnotations(unknown: UnknownAnnotation[]): void {
  if (unknown.length === 0) return;
  console.log(
    `\nAnnotations referencing unknown scenarios (typo? renamed scenario? stale binding?):`,
  );
  for (const a of unknown) {
    console.log(`  ✗ @scenario ${a.title}`);
    console.log(`    ${a.ref.file}:${a.ref.line}`);
  }
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
        errors.push(
          `${name} entry does not resolve to an existing .feature file: ${entry}`,
        );
      } else {
        errors.push(
          `${name} entry is not discovered under the configured spec roots: ${entry}`,
        );
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
  /** Inert files, whether excused or not — a count worth printing on its own. */
  inert: InertReport[];
  /** Inert files LEGACY_INERT excuses, and so still tolerated. */
  exemptInert: InertReport[];
  /** Inert files nobody has excused. Fatal. */
  newInert: InertReport[];
  /** Entries that no longer belong on their list, and must leave it. Fatal. */
  staleLegacy: LegacyReport[];
  staleInert: string[];
  unknownAnnotations: UnknownAnnotation[];
  listErrors: string[];
}

function analyzeParity(): ParityAnalysis {
  const allFeatures = discoverFeatureFiles();
  const listErrors = [
    ...validateExemptionList({
      name: "LEGACY_UNBOUND",
      entries: LEGACY_UNBOUND,
      allFeatures,
    }),
    ...validateExemptionList({
      name: "LEGACY_INERT",
      entries: LEGACY_INERT,
      allFeatures,
    }),
  ];

  const bindings = [
    ...collectAllBindings(DEFAULT_TEST_ROOTS),
    ...collectBatsBindings(DEFAULT_BATS_TEST_ROOTS),
    ...collectShellBindings(DEFAULT_SHELL_TEST_ROOTS),
    ...collectGoBindings(DEFAULT_GO_TEST_ROOTS),
    ...collectPythonBindings(DEFAULT_PYTHON_TEST_ROOTS),
  ];
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

  // Inert floor. A file that declares scenarios and enforces none of them is a
  // failure unless it was already in that state when the floor was introduced.
  const inertSet = new Set(LEGACY_INERT);
  const inert = enforced.filter(isInert).map(toInertReport);
  const inertFeatures = new Set(inert.map((r) => r.feature));

  return {
    enforced,
    legacy,
    inert,
    exemptInert: inert.filter((r) => inertSet.has(r.feature)),
    newInert: inert.filter((r) => !inertSet.has(r.feature)),
    // Legacy-list hygiene: every entry must still have at least one unbound
    // scenario. If a file is fully bound, it must be removed from the list.
    staleLegacy: legacy.filter((r) => r.unbound === 0),
    // Ratchet hygiene: an entry that is no longer inert has been fixed, and
    // must leave the list so it can never silently regress.
    staleInert: LEGACY_INERT.filter(
      (f) => allFeatures.includes(f) && !inertFeatures.has(f),
    ),
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

  for (const r of a.enforced) printEnforcedReport(r);
  printLegacySummary(a.legacy);
  printInertSummary(a.exemptInert);
  printNewInert(a.newInert);
  printUnknownAnnotations(a.unknownAnnotations);
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
  if (a.newInert.length > 0) {
    reasons.push(
      `${a.newInert.length} file(s) enforce no scenario at all (nothing in them is tagged @unit/@integration/@e2e/@regression)`,
    );
  }
  if (a.staleInert.length > 0) {
    reasons.push(
      `${a.staleInert.length} file(s) in LEGACY_INERT now enforce scenarios — remove them from the list: ${a.staleInert.join(
        ", ",
      )}`,
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
  if (a.exemptInert.length > 0) {
    const invisible = a.exemptInert.reduce((s, r) => s + r.totalScenarios, 0);
    console.log(
      `    ${a.exemptInert.length} file(s) exempted via LEGACY_INERT enforce nothing at all — ${invisible} scenario(s) are invisible to this check.`,
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
          inert: analysis.exemptInert,
          newInert: analysis.newInert,
          staleInert: analysis.staleInert,
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
 *
 * A plain string compare of `process.argv[1]` against `import.meta.url` is
 * fail-OPEN: invoke the check through a symlink — a `node_modules/.bin` shim, a
 * pnpm store link, a worktree symlinked into place — and the two paths differ,
 * the guard declines to run `main()`, and the process exits 0 having checked
 * nothing. A parity gate that silently no-ops is worse than no gate. So both
 * sides are resolved through `realpathSync` before comparing.
 *
 * `realpathSync` throws if the path does not exist (argv[1] can be anything);
 * falling back to the lexically-resolved path keeps that case a mismatch rather
 * than a crash.
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
