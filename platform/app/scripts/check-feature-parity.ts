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
 * Polarity: enforce-all by default, and fail closed. Four ratcheted deny-lists
 * carry the migration debt, and all of them only ever shrink:
 *
 *   - `LEGACY_UNBOUND`  — files with enforced-but-unbound scenarios.
 *   - `LEGACY_INERT`    — files that yield NO enforced scenario at all, because
 *                         nothing in them is tagged. Without this list such a
 *                         file reports `0/0 scenarios bound · ✓ all bound` and
 *                         passes, which is an assertion of coverage that does
 *                         not exist. Any file that becomes inert and is not on
 *                         the list is a hard failure.
 *   - `LEGACY_PARTIALLY_INERT`
 *                       — files where SOME scenarios are tagged and the rest
 *                         are neither tagged nor `@unimplemented`. `LEGACY_INERT`
 *                         only ever caught the all-or-nothing case, so one tagged
 *                         scenario used to launder every untagged sibling in the
 *                         same file into invisibility behind a `✓ all bound`.
 *   - `LEGACY_INTENT_TAGS`
 *                       — private "not done yet" tags (`@planned`, `@roadmap`, …)
 *                         that read as binding intent but mean nothing to this
 *                         checker. Parking a scenario is a claim, and it has
 *                         exactly one spelling here: `@unimplemented`.
 *
 * Every scenario therefore lands in exactly one of three states — enforced and
 * bound, explicitly parked as `@unimplemented`, or counted as HIDDEN against a
 * shrink-only allowlist. There is no fourth state where a scenario is simply
 * not looked at.
 *
 * Shrinking these lists toward zero is the work tracked by #3338.
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
 *
 * `python-sdk/specs` was missing for the same reason, discovered later: every
 * scenario under it — fully tagged `@unit` / `@integration` in every file —
 * bound nothing and was invisible to this check, not because the behaviour
 * was untested but because nothing in `python-sdk` carried the `@scenario`
 * annotation this checker looks for. Adding the root did not make those files
 * pass; it made the gap visible. See `LEGACY_UNBOUND` for the files that
 * surfaced already in that state.
 */
const SPECS_ROOTS = [
  resolve(REPO_ROOT, "specs"),
  resolve(REPO_ROOT, "sdks/typescript/specs"),
  resolve(REPO_ROOT, "sdks/python/specs"),
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
  // One root: the single workspace put every package under it, so the former
  // app-local packages tree is the same place as the top-level one.
  "packages",
  "mcp/typescript/src",
  "sdks/typescript/src",
  "sdks/python/src",
  // What we SHIP as instructions is behavior too: the skill sources and the
  // assistant's rules are tested here (and nowhere else), so scenarios about
  // what an instruction teaches can only bind from this root.
  "skills/_tests",
];

/**
 * Roots scanned for `.bats` shell tests. Shell-driven dev-environment
 * behavior (compose overrides, boxd fork orchestration) is tested with
 * bats, not vitest — without this scan path, scenarios that describe
 * shell behavior would have no way to satisfy parity and would be stuck
 * on `@unimplemented` forever. Bats bindings use the same `@scenario`
 * token, expressed as a hash-comment directly above an `@test "..." {`
 * line.
 */
const DEFAULT_BATS_TEST_ROOTS: string[] = [
  "scripts/__tests__",
  "platform/app/scripts/__tests__",
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
  "pkg",
  "tools/thuishaven",
  "tools/herrgen",
  // The goose migration-order gate. `specs/ci/migration-order.feature` is
  // satisfied by `tools/migrationorder`'s Go tests and by nothing else; without
  // this root its scenarios could only ever be @unimplemented.
  "tools/migrationorder",
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
  "langevals",
  "langwatch_server",
  "python-sdk",
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
  // `@integration` tag is bound. Most of its scenarios carry no tag at all:
  // `sdks/typescript/specs/cli/daemon.feature`, for one, has 35 scenarios of
  // which 2 are enforced and none are @unimplemented. `LEGACY_INERT` below
  // catches a file where that count falls to zero; `LEGACY_PARTIALLY_INERT`
  // catches a partially-tagged file like that one, which used to fall through
  // both. Tagging the remainder is still outstanding — but it is now counted.
  //
  // The consolidated Langy/home corpus landed while feature parity was already
  // enforce-all, but its tests predate @scenario bindings. Keep the debt
  // explicit and file-scoped while #3338 drives this list back to empty; new
  // feature files remain enforced by default.
  "specs/home/home-views.feature",
  "specs/home/learning-resources.feature",
  "specs/langy/langy-api-key-provisioning.feature",
  "specs/langy/langy-capability-cards.feature",
  "specs/langy/langy-cli-tool-envelope.feature",
  "specs/langy/langy-context-system.feature",
  "specs/langy/langy-dual-stream.feature",
  "specs/langy/langy-feedback.feature",
  "specs/langy/langy-followup-suggestions.feature",
  "specs/langy/langy-frontend-realtime.feature",
  "specs/langy/langy-github-install.feature",
  "specs/langy/langy-github-prs.feature",
  "specs/langy/langy-plan-progress.feature",
  "specs/langy/langy-projection-independent-reactions.feature",
  "specs/langy/langy-turn-recovery.feature",

  // Surfaced by adding `python-sdk/specs` to SPECS_ROOTS. Every scenario in
  // these three files carries a `@unit` / `@integration` tag, so they were
  // never inert — they were invisible, the same trap `typescript-sdk/specs`
  // fell into above. Unlike that case, the behaviour these describe is not
  // untested: `python-sdk/tests/experiment/test_with_target.py`,
  // `test_with_target_integration.py`, and the two
  // `test_server_run_results.py` files (experiment + workflow) have a test
  // method or class for nearly every scenario here — e.g.
  // `TestTargetBasics.test_target_creates_dataset_entry` for "target creates
  // dataset entry per target". What's missing is the `@scenario` annotation
  // this checker reads, not the test. Binding them means editing
  // `python-sdk/tests/`, which is out of scope for the change that added
  // this root — tracked here rather than claimed as `@unimplemented`, which
  // would be false.
  "python-sdk/specs/evaluation/with_target.feature",
  "python-sdk/specs/experiment/server_run_results.feature",
  "python-sdk/specs/workflow/server_run_results.feature",
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
  "specs/ai-gateway/advanced-routing.feature",
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
  "specs/ai-gateway/governance/admin-routing-policies.feature",
  "specs/ai-gateway/governance/anomaly-detection.feature",
  "specs/ai-gateway/governance/anomaly-rules.feature",
  "specs/ai-gateway/governance/architecture-invariants.feature",
  "specs/ai-gateway/governance/birds-eye-dashboard-v2.feature",
  "specs/ai-gateway/governance/budget-exceeded.feature",
  "specs/ai-gateway/governance/c3-alert-dispatch.feature",
  "specs/ai-gateway/governance/cli-402-license-gate.feature",
  "specs/ai-gateway/governance/cli-deep-links.feature",
  "specs/ai-gateway/governance/cli-ingest-debug.feature",
  "specs/ai-gateway/governance/cli-login.feature",
  "specs/ai-gateway/governance/cli-tool-mode-policy.feature",
  "specs/ai-gateway/governance/compliance-baseline.feature",
  "specs/ai-gateway/governance/feature-flag-gating.feature",
  "specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature",
  "specs/ai-gateway/governance/governance-home-routing.feature",
  "specs/ai-gateway/governance/guardrails-project-scope.feature",
  "specs/ai-gateway/governance/ingest-api-key-lifecycle.feature",
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
  "specs/ai-gateway/model-disambiguation.feature",
  "specs/ai-gateway/model-provider-scoping.feature",
  "specs/ai-gateway/openai-param-compat.feature",
  "specs/ai-gateway/payload-capture.feature",
  "specs/ai-gateway/policy-rules.feature",
  "specs/ai-gateway/prometheus-metrics.feature",
  "specs/ai-gateway/public-rest-api.feature",
  "specs/ai-gateway/rate-limits.feature",
  "specs/ai-gateway/rbac-legacy-admin-fallback.feature",
  "specs/ai-gateway/self-hosting/gateway-finds-its-control-plane.feature",
  "specs/ai-gateway/self-hosting/personal-keys-deployment.feature",
  "specs/ai-gateway/semantic-caching.feature",
  "specs/ai-gateway/span-shape.feature",
  "specs/ai-gateway/trace-propagation.feature",
  "specs/ai-gateway/wrapper-e2e/claude.feature",
  "specs/ai-gateway/wrapper-e2e/codex.feature",
  "specs/ai-gateway/wrapper-e2e/cursor.feature",
  "specs/ai-gateway/wrapper-e2e/gemini.feature",
  "specs/ai-gateway/wrapper-e2e/opencode.feature",
  "specs/ai-governance/cli-wrappers/cli-mints-ingest-key.feature",
  "specs/ai-governance/cli-wrappers/latest-login-wins.feature",
  "specs/ai-governance/cli-wrappers/logout.feature",
  "specs/ai-governance/cli-wrappers/request-increase.feature",
  "specs/ai-governance/cli-wrappers/shell-rc-persistence.feature",
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
  "specs/automations/authoring-drawer.feature",
  "specs/automations/dispatch-timing.feature",
  "specs/automations/notification-templates.feature",
  "specs/automations/process-manager-dispatch.feature",
  "specs/automations/spam-prevention.feature",
  "specs/automations/webhook-http-action.feature",
  "specs/batch-evaluation-results/run-comparison.feature",
  "specs/batch-evaluation-results/target-metadata-api.feature",
  "specs/ci/no-committed-screenshots.feature",
  "specs/ci/no-docker-integration-tests.feature",
  "specs/ci/path-filters.feature",
  "specs/ci/pr-impact-map.feature",
  "specs/claude/drive-pr.feature",
  "specs/claude/telemetry-turn-bounding.feature",
  "specs/coding-agent/personal-usage.feature",
  "specs/coding-agent/terminal-view.feature",
  "specs/components/code-block-editor.feature",
  "specs/components/hoverable-big-text-overflow.feature",
  "specs/data-retention/monitoring.feature",
  "specs/datasets/add-to-dataset-span-mapping.feature",
  "specs/dependencies/supply-chain-age-gates.feature",
  "specs/evaluations/evaluation-payload-offload.feature",
  "specs/evaluations/experiments-online-evaluations-separation.feature",
  "specs/evaluators/create-workflow-evaluator.feature",
  "specs/evaluators/evaluator-cli.feature",
  "specs/evaluators/evaluator-error-propagation.feature",
  "specs/evaluators/satisfaction-score-migration.feature",
  "specs/evaluators/thread-eval-skips-without-thread-id.feature",
  "specs/evaluators/workflow-evaluator-editor.feature",
  "specs/event-sourcing/global-projections.feature",
  "specs/event-sourcing/process-roles.feature",
  "specs/experiments-v3/autosave-status.feature",
  "specs/experiments-v3/dataset-inline-editing.feature",
  "specs/experiments-v3/evaluation-creation-entrypoints.feature",
  "specs/experiments-v3/evaluation-execution.feature",
  "specs/experiments-v3/evaluator-configuration.feature",
  "specs/experiments-v3/evaluator-mappings.feature",
  "specs/experiments-v3/execution-controls.feature",
  "specs/experiments-v3/http-agent-support.feature",
  "specs/experiments-v3/per-dataset-mappings.feature",
  "specs/experiments-v3/table-display.feature",
  "specs/experiments-v3/undo-redo.feature",
  "specs/experiments/comparison.feature",
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
  "specs/langy/langy-deploy-hardening.feature",
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
  "specs/licensing/dual-pricing-model.feature",
  "specs/licensing/enforcement-hono-api.feature",
  "specs/licensing/license-activation-ui.feature",
  "specs/licensing/license-generation.feature",
  "specs/licensing/license-lifecycle-e2e.feature",
  "specs/licensing/license-page-styling.feature",
  "specs/licensing/license-status-ui.feature",
  "specs/licensing/notification-coverage-gaps.feature",
  "specs/licensing/proration-preview.feature",
  "specs/licensing/resource-limit-notifications.feature",
  "specs/licensing/subscription-page.feature",
  "specs/licensing/usage-page-navigation.feature",
  "specs/mcp/typescript/analytics-tool.feature",
  "specs/mcp/typescript/api-key-tools.feature",
  "specs/mcp/typescript/experiment-results-tool.feature",
  "specs/mcp/typescript/project-api-key-tools.feature",
  "specs/mcp/typescript/project-tools.feature",
  "specs/mcp/typescript/prompt-tools.feature",
  "specs/mcp/typescript/scenario-tool-formatters.feature",
  "specs/members/member-role-team-restrictions.feature",
  "specs/migration/vite-migration.feature",
  "specs/model-config/anthropic-empty-content.feature",
  "specs/model-config/litellm-reasoning-params.feature",
  "specs/model-config/model-parameter-display.feature",
  "specs/model-config/model-selector-ux.feature",
  "specs/model-config/unified-reasoning-ui.feature",
  "specs/model-providers/codex-account-provider.feature",
  "specs/model-providers/custom-model-max-tokens.feature",
  "specs/model-providers/default-provider.feature",
  "specs/model-providers/provider-list.feature",
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
  "specs/navigation/shared-section-navigation-layout.feature",
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
  "specs/npx-installer/07-lean-install.feature",
  "specs/observability/browser-rum-trace-correlation.feature",
  "specs/observability/process-substrate-alerting.feature",
  "specs/ops/clickhouse-backup-metrics.feature",
  "specs/ops/dashboard-latency.feature",
  "specs/ops/dejaview-impersonation-access.feature",
  "specs/ops/internal-feature-flags.feature",
  "specs/ops/local-observability-stack.feature",
  "specs/ops/production-bundle-integrity.feature",
  "specs/otlp/canonical-log-ingestion.feature",
  "specs/otlp/canonical-metric-ingestion.feature",
  "specs/projects/create-project-drawer.feature",
  "specs/projects/project-list-refresh.feature",
  "specs/prompts/custom-prompt-tags.feature",
  "specs/prompts/liquid-template-support.feature",
  "specs/prompts/open-existing-prompt-from-trace.feature",
  "specs/prompts/open-trace-in-playground.feature",
  "specs/prompts/prompt-selection-drawer.feature",
  "specs/prompts/structured-outputs-streaming.feature",
  "specs/prompts/unified-defaults.feature",
  "specs/sdks/python/async-experiment-parallelism.feature",
  "specs/sdks/python/experiment-print-summary.feature",
  "specs/rbac/fetch-org-role-permission-resolution.feature",
  "specs/scenarios/ai-create-modal.feature",
  "specs/scenarios/event-driven-execution-prep.feature",
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
  "specs/scenarios/stalled-scenario-runs.feature",
  "specs/secrets/secrets-manager.feature",
  "specs/security/org-level-tenancy-enforcement.feature",
  "specs/security/tenant-aware-egress-isolation.feature",
  "specs/server/metrics-collection.feature",
  "specs/server/spa-fallback.feature",
  "specs/server/worker-liveness-probe.feature",
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
  "specs/traces-v2/accessibility.feature",
  "specs/traces-v2/annotations.feature",
  "specs/traces-v2/attribute-value-readability.feature",
  "specs/traces-v2/bulk-actions.feature",
  "specs/traces-v2/column-configuration.feature",
  "specs/traces-v2/conditional-formatting.feature",
  "specs/traces-v2/conversation-context-turn-counts.feature",
  "specs/traces-v2/conversation-message-expand.feature",
  "specs/traces-v2/conversation-turn-ledger.feature",
  "specs/traces-v2/editable-trace-name-alignment.feature",
  "specs/traces-v2/evaluations.feature",
  "specs/traces-v2/facet-perspectives.feature",
  "specs/traces-v2/flame-graph.feature",
  "specs/traces-v2/grouping-engine.feature",
  "specs/traces-v2/io-pretty-markdown.feature",
  "specs/traces-v2/lens-preset-groups.feature",
  "specs/traces-v2/light-mode-contrast.feature",
  "specs/traces-v2/live-tail.feature",
  "specs/traces-v2/message-translation.feature",
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
  "specs/sdks/typescript/cli-docs.feature",
  "specs/sdks/typescript/cli-error-handling.feature",
  "specs/sdks/typescript/cli-experiment-results.feature",
  "specs/sdks/typescript/cli-projects-api-keys.feature",
  "specs/sdks/typescript/prompt-tags.feature",
  "specs/variables-ui/prompt-editor-drawer-mappings.feature",
  "specs/workflows/studio-drawer-migration.feature",
  "specs/workflows/studio-evaluator-node-drawer.feature",
  "specs/workflows/studio-evaluator-sidebar.feature",
  "specs/workflows/studio-llm-node-drawer.feature",
  "specs/workflows/studio-local-state.feature",
  "specs/workflows/studio-usage-limits.feature",
  "specs/workflows/workflow-management.feature",
];

/**
 * Feature files where SOME scenarios are enforced and the rest are neither
 * tagged nor `@unimplemented`.
 *
 * `LEGACY_INERT` above is all-or-nothing: it only fires when a file yields ZERO
 * enforced scenarios. So a single `@unit` anywhere in a file promoted the whole
 * file to "enforced", and every untagged sibling in it became invisible —
 * counted as neither enforced nor parked, reported nowhere, and printed as
 * `✓ all bound`. That is the same false assertion of coverage `LEGACY_INERT`
 * exists to stop, hiding one level down.
 *
 * A HIDDEN scenario is one carrying no `@unit` / `@integration` / `@e2e` /
 * `@regression` and no `@unimplemented`. Hidden is not a verdict about the
 * behaviour — it is the absence of one. Both spellings of a verdict are cheap,
 * so declining to give one is the thing this list makes expensive.
 *
 * Direction: drive this list to empty by tagging the scenarios whose behaviour
 * we test, marking `@unimplemented` the ones we do not, and deleting the ones
 * that no longer describe anything.
 *
 * This list MAY ONLY BE REMOVED FROM, NEVER ADDED TO. A file that becomes
 * partially inert and is not already here is a hard failure — the fix is a tag
 * on the scenario, not a line in this array.
 *
 * Invariants (enforced below):
 *   - Every path must resolve to a discovered `.feature` file.
 *   - Every entry must still be partially inert. A file that has since had its
 *     hidden scenarios tagged must be removed — that is the ratchet clicking.
 */
const LEGACY_PARTIALLY_INERT: string[] = [
  "specs/ai-gateway/budgets.feature",
  "specs/ai-gateway/cli-token-revoke-on-deactivation.feature",
  "specs/ai-gateway/gateway-service.feature",
  "specs/ai-gateway/governance/admin-trace-access.feature",
  "specs/ai-gateway/governance/departments.feature",
  "specs/ai-gateway/governance/folds.feature",
  "specs/ai-gateway/governance/ingestion-templates-catalog.feature",
  "specs/ai-gateway/governance/my-usage-dashboard.feature",
  "specs/ai-gateway/governance/persona-home-resolver.feature",
  "specs/ai-gateway/governance/ui-contract.feature",
  "specs/ai-gateway/governance/workspace-switcher.feature",
  "specs/ai-gateway/virtual-keys.feature",
  "specs/ai-governance/cli-onboarding/login-unified.feature",
  "specs/ai-governance/personal-portal/admin-catalog-editor.feature",
  "specs/ai-governance/personal-portal/tool-catalog-rbac.feature",
  "specs/analytics/event-sourced-analytics-materialization.feature",
  "specs/ci/migration-order.feature",
  "specs/dependencies/zod-first-schema-source-of-truth.feature",
  "specs/experiments-v3/mapping-auto-inference.feature",
  "specs/experiments-v3/mapping-validation.feature",
  "specs/features/dataset-cli.feature",
  "specs/langevals-staging/staged-payload.feature",
  "specs/langy/langy-panel-layout.feature",
  "specs/model-providers/credential-validation.feature",
  "specs/model-providers/onboarding-flow.feature",
  "specs/model-providers/provider-configuration.feature",
  "specs/model-providers/provider-deletion.feature",
  "specs/model-providers/scope-and-multi-instance.feature",
  "specs/optimization-studio/component-execution.feature",
  "specs/prompts/editing-modes.feature",
  "specs/prompts/locked-input-variable.feature",
  "specs/queue-pausing/queue-pausing.feature",
  "specs/rbac/scoped-role-bindings.feature",
  "specs/suites/suite-model-selection.feature",
  "specs/suites/suite-run-aggregates.feature",
  "specs/traces-v2/code-block-language-fallback.feature",
  "specs/traces-v2/evaluator-filter-label.feature",
  "specs/traces-v2/filter-bar-interactions.feature",
  "specs/traces-v2/numeric-facet-modes.feature",
  "specs/traces-v2/search.feature",
  "specs/traces/saved-views.feature",
  "sdks/typescript/specs/cli/daemon.feature",
];

/**
 * Tags that assert a coverage or deferral verdict but mean NOTHING to this
 * checker.
 *
 * `@deferred` was the case that exposed this: a scenario carrying it is not
 * enforced (it is not a binding tag) and not parked (it is not
 * `@unimplemented`), so it fell clean through the accounting while its file
 * reported `3/3 · ✓ all bound`. The tag reads, to a human, exactly like a
 * decision that was recorded — which is what makes it worse than no tag at all.
 *
 * Parking a scenario is a real claim and it has exactly one spelling here:
 * `@unimplemented`. A scenario may still carry `@deferred`, `@planned` or any
 * other word as a human note, but it must ALSO carry the tag the checker
 * counts.
 *
 * This deny-list is a targeted diagnostic, not the structural guarantee — a
 * private convention nobody has thought to list here is still caught, because
 * a scenario wearing it is HIDDEN and hidden is now counted by
 * `LEGACY_PARTIALLY_INERT` / `LEGACY_INERT`. What listing a tag buys is a
 * precise error naming the tag and the word to use instead, rather than a file
 * appearing on an allowlist for reasons the author has to go and work out.
 *
 * Adding a tag here TIGHTENS the check and is always welcome.
 */
const INTENT_TAGS: readonly string[] = [
  "@deferred",
  "@future",
  "@not-implemented",
  "@notimplemented",
  "@out_of_scope",
  "@parking",
  "@pending",
  "@planned",
  "@postponed",
  "@roadmap",
  "@skipped",
  "@todo",
  "@wip",
];

/**
 * RATCHET: intent tags already in unaccounted use when the rule above landed.
 *
 * Each of these sits on scenarios that carry no binding tag and no
 * `@unimplemented`. They are listed rather than fixed because retagging them
 * spans feature files across several teams' trees, and failing the whole repo's
 * CI on that would make a useful rule unlandable.
 *
 * Removing an entry means every scenario wearing that tag now also carries
 * `@unimplemented` or a binding tag — a repo-wide cleanup for one word.
 *
 * This list MAY ONLY BE REMOVED FROM, NEVER ADDED TO. Every other tag in
 * `INTENT_TAGS` is enforced from the moment it is listed, so a NEW private
 * convention cannot be parked here on the way in.
 *
 * Invariant (enforced below): every entry must still have at least one
 * unaccounted use. A tag that has been fully cleaned up must be removed, or it
 * sits here silently re-exempting the convention the next time someone reaches
 * for it.
 */
const LEGACY_INTENT_TAGS: readonly string[] = [
  "@future",
  "@out_of_scope",
  "@planned",
  "@roadmap",
];

/**
 * Files whose `@scenario` occurrences are FIXTURE DATA for this checker's own
 * tests, not bindings.
 *
 * `check-feature-parity.unit.test.ts` feeds the collector deliberately
 * well-formed AND deliberately malformed annotations to pin how each is
 * classified. Scanning it means reading those probes as real annotations, which
 * reports the checker's own test suite as a dozen defects. This is a structural
 * exclusion, not an exemption: a fixture that is malformed ON PURPOSE is not
 * debt to be ratcheted down, so it does not belong on an allow-list.
 *
 * Keep this list to self-referential fixtures. Anything else that "looks like"
 * a false positive is a real annotation and belongs in the code or on the
 * ratchet below.
 */
const ANNOTATION_SCAN_EXCLUDED_FILES: readonly string[] = [
  "platform/app/scripts/__tests__/check-feature-parity.unit.test.ts",
];

/**
 * RATCHET: `@scenario` annotations that already bound nothing when the
 * dangling-annotation check was introduced.
 *
 * Each entry is an annotation sitting somewhere the collector cannot bind it —
 * above a `describe(`, or prose that merely borrows the marker. They are real
 * defects: the scenario named reads as covered by a test that never runs for
 * it. They are listed rather than fixed only because the check landed after
 * they did, and failing the whole repo's CI on unrelated pre-existing debt
 * would make a useful check unlandable.
 *
 * This list MAY ONLY BE REMOVED FROM, NEVER ADDED TO.
 *
 * A NEW inert annotation is a hard failure — fix it at the source by moving the
 * annotation onto the `it(` it describes, or by dropping the marker if the text
 * is prose. If you are here because CI told you to add an entry, that is the
 * bug this list exists to stop spreading.
 *
 * Keyed by file AND scenario text, so moving the annotation to a different file
 * or renaming the scenario re-arms the check rather than silently inheriting
 * the exemption.
 */
const LEGACY_INERT_ANNOTATIONS: readonly { file: string; title: string }[] = [
  {
    file: "platform/app/src/components/prompts/__tests__/PromptEditorDrawer.test.tsx",
    title: "The drawer's init effect runs once and locks in",
  },
  {
    file: "platform/app/src/components/settings/__tests__/ModelProviderForm.advanced-gateway.integration.test.tsx",
    title:
      "Advanced (Gateway) is hidden when the AI gateway feature flag is off",
  },
  {
    file: "platform/app/src/components/settings/__tests__/ModelProviderForm.advanced-gateway.integration.test.tsx",
    title:
      "Advanced (Gateway) renders as a collapsed accordion when the flag is on",
  },
  {
    file: "platform/app/src/components/settings/__tests__/ModelProviderForm.advanced-gateway.integration.test.tsx",
    title:
      "Single Save persists basic credentials and advanced gateway fields together",
  },
  {
    file: "platform/app/src/components/settings/__tests__/ModelProviderForm.edit-row-resolution.integration.test.tsx",
    title: "Editing a row shows its own saved credential, not another row's",
  },
  {
    file: "platform/app/src/components/settings/__tests__/ModelProviderForm.edit-row-resolution.integration.test.tsx",
    title: "Saving an edited row updates it in place, not as a duplicate",
  },
  {
    file: "platform/app/src/components/traces/__tests__/audioPlayerInTraces.integration.test.tsx",
    title: "annotations, so the parity check sees real rendering coverage —",
  },
  {
    file: "platform/app/src/features/traces-v2/components/TraceDrawer/panes/__tests__/ResizeRail.integration.test.tsx",
    title: "Double-click the grip toggles maximize and restore",
  },
  {
    file: "platform/app/src/features/traces-v2/components/TraceDrawer/panes/__tests__/ResizeRail.integration.test.tsx",
    title: "Drag the left-edge grip to resize the drawer",
  },
  {
    file: "platform/app/src/features/traces-v2/components/TraceDrawer/panes/__tests__/ResizeRail.integration.test.tsx",
    title: "Hit area covers full drawer height",
  },
  {
    file: "platform/app/src/features/traces-v2/components/TraceDrawer/panes/__tests__/ResizeRail.integration.test.tsx",
    title: "Rail is not keyboard-focusable",
  },
  {
    file: "platform/app/src/features/traces-v2/components/TraceDrawer/panes/__tests__/ResizeRail.integration.test.tsx",
    title: "Single-click the grip does NOT toggle width",
  },
  {
    file: "platform/app/src/features/traces-v2/components/TraceDrawer/panes/__tests__/ResizeRail.integration.test.tsx",
    title: "Width is clamped to a maximum",
  },
  {
    file: "platform/app/src/features/traces-v2/components/TraceDrawer/panes/__tests__/ResizeRail.integration.test.tsx",
    title: "Width is clamped to a minimum",
  },
  {
    file: "platform/app/src/features/traces-v2/stores/__tests__/drawerStore.unit.test.ts",
    title: "Collapsing a pane reduces it to header-only",
  },
  {
    file: "platform/app/src/features/traces-v2/stores/__tests__/drawerStore.unit.test.ts",
    title: "Deep link / refresh opens the drawer without a `t` hint",
  },
  {
    file: "platform/app/src/features/traces-v2/stores/__tests__/drawerStore.unit.test.ts",
    title: "Double-click the grip toggles maximize and restore",
  },
  {
    file: "platform/app/src/features/traces-v2/stores/__tests__/drawerStore.unit.test.ts",
    title: "Drag the left-edge grip to resize the drawer",
  },
  {
    file: "platform/app/src/features/traces-v2/stores/__tests__/drawerStore.unit.test.ts",
    title: "Maximize-within-group hides siblings",
  },
  {
    file: "platform/app/src/features/traces-v2/stores/__tests__/drawerStore.unit.test.ts",
    title: "Span-detail collapse round-trip preserves the selection",
  },
  {
    file: "platform/app/src/features/traces-v2/stores/__tests__/drawerStore.unit.test.ts",
    title: "Width is clamped to a minimum",
  },
  {
    file: "platform/app/src/features/traces-v2/stores/__tests__/drawerStore.unit.test.ts",
    title: "Width persists across sessions",
  },
  {
    file: "platform/app/src/pages/settings/__tests__/authentication.integration.test.tsx",
    title:
      "Auth0 social-only user (Google via Auth0) does not see Change Password",
  },
  {
    file: "platform/app/src/prompts/utils/__tests__/llmPromptConfigUtils.test.ts",
    title: "Prompt form values preserve runtime parameters during API mapping",
  },
  {
    file: "platform/app/src/prompts/utils/__tests__/llmPromptConfigUtils.test.ts",
    title: "Runtime parameters validation accepts object JSON values",
  },
  {
    file: "platform/app/src/prompts/utils/__tests__/llmPromptConfigUtils.test.ts",
    title: "Runtime parameters validation rejects non-object root values",
  },
  {
    file: "platform/app/src/server/api/routers/__tests__/sharedTrace.shareSafe.unit.test.ts",
    title: "Asymmetric policy: evaluator free text quotes both sides, so",
  },
  {
    file: "platform/app/src/server/api/routers/__tests__/sharedTrace.shareSafe.unit.test.ts",
    title: "Fail-closed on a policy outage. `getUserProtectionsForProject`",
  },
  {
    file: "platform/app/src/server/app-layer/ops/__tests__/integration/latency-tiles.integration.test.ts",
    title: "P50 and P99 reflect recent job durations after completion",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/blob-store.event-log.unit.test.ts",
    title: "Cross-tenant event_log read is structurally denied",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/blob-store.event-log.unit.test.ts",
    title:
      "Read path is object-storage-independent (ADR-022 on-prem / no-object-storage).",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/edge-offload.unit.test.ts",
    title:
      "An over-threshold command is spooled to S3 transiently and reconstituted",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/edge-offload.unit.test.ts",
    title:
      "When edge S3 spool PUT fails, ingestion falls back to inline (fail-open)",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/large-trace-blob-offload.integration.test.ts",
    title:
      "An over-threshold command is spooled to S3 transiently and reconstituted",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/large-trace-blob-offload.integration.test.ts",
    title: "With the flag off, ingestion and reads behave exactly as before",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/large-trace-blob-offload.integration.test.ts",
    title:
      "event_log carries the full event content; projection queue carries the lean shape",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/lean-for-projection.unit.test.ts",
    title:
      ">256KB blob nested inside arrayValue of a NON-IO attribute is capped (spool-path fix)",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/lean-for-projection.unit.test.ts",
    title:
      "IO attr (gen_ai.input.messages) with >64KB stringValue is still IO-previewed with eventref",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/lean-for-projection.unit.test.ts",
    title:
      "REGRESSION sibling — >256KB value ONLY in resource.attributes, nothing oversized",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/lean-for-projection.unit.test.ts",
    title:
      "REGRESSION — >256KB value ONLY in span.events[].attributes, nothing oversized at",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/lean-for-projection.unit.test.ts",
    title: "leanForProjection is the single source of truth for the lean shape",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/lean-for-projection.unit.test.ts",
    title:
      "non-IO stringValue over 256 KB is capped in the lean output (spool-path fix)",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/lean-for-projection.unit.test.ts",
    title:
      "small structured non-IO attr — must not trigger clone (hot-path guard)",
  },
  {
    file: "platform/app/src/server/app-layer/traces/__tests__/lean-for-projection.unit.test.ts",
    title: "sub-threshold event — no-op, no allocations (hot-path guard)",
  },
  {
    file: "platform/app/src/server/evaluators/__tests__/codeEvaluator.unit.test.ts",
    title: "Code evaluator executes through the engine code component",
  },
  {
    file: "platform/app/src/server/modelProviders/__tests__/modelProvider.enabledCollapse.integration.test.ts",
    title: "Disabled PROJECT row must not mask an enabled ORGANIZATION row.",
  },
  {
    file: "platform/app/src/server/modelProviders/__tests__/modelProvider.enabledCollapse.integration.test.ts",
    title: "When both rows are enabled, the narrower (PROJECT) scope",
  },
  {
    file: "platform/app/src/tasks/__tests__/backfillDatasetContentToS3.unit.test.ts",
    title: "An existing dataset stays usable after the storage migration",
  },
  {
    file: "platform/app/src/tasks/__tests__/backfillDatasetContentToS3.unit.test.ts",
    title: "Migration never silently drops a concurrent write",
  },
  {
    file: "platform/app/src/tasks/__tests__/backfillDatasetContentToS3.unit.test.ts",
    title: "The storage migration is safe to run more than once",
  },
  {
    file: "skills/_tests/experiments-python-openai.scenario.test.ts",
    title: "Use the experiments skill for batch testing",
  },
  {
    file: "sdks/typescript/src/cli/commands/__tests__/cli-error-propagation-commands.integration.test.ts",
    title:
      "Common error conditions map to actionable messages for every CLI command",
  },
  {
    file: "sdks/typescript/src/cli/commands/__tests__/push.unit.test.ts",
    title: "Syncing a local prompt detects runtime parameters conflicts",
  },
  {
    file: "sdks/typescript/src/cli/commands/__tests__/push.unit.test.ts",
    title: "TypeScript local prompt files preserve runtime parameters",
  },
];

function isLegacyInertAnnotation(a: {
  title: string;
  ref: BindingRef;
}): boolean {
  return LEGACY_INERT_ANNOTATIONS.some(
    (e) => e.file === a.ref.file && e.title === a.title,
  );
}

const TEST_FILE_RE = /\.test\.tsx?$/;
const BATS_FILE_RE = /\.bats$/;
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
  /**
   * Of those, how many carry NEITHER a binding tag NOR `@unimplemented` — the
   * scenarios this check would otherwise never mention. See
   * `LEGACY_PARTIALLY_INERT`.
   */
  hiddenScenarios: Scenario[];
}

/** A feature file that declares scenarios but no ENFORCED ones. */
interface InertReport {
  feature: string;
  totalScenarios: number;
  /** Of those, how many are explicitly parked as `@unimplemented`. */
  unimplemented: number;
}

/**
 * A feature file that enforces SOME of its scenarios and leaves the rest
 * neither tagged nor `@unimplemented`.
 */
interface PartiallyInertReport {
  feature: string;
  totalScenarios: number;
  /** Scenarios carrying a binding tag. */
  enforced: number;
  /** Scenarios explicitly parked as `@unimplemented`. */
  unimplemented: number;
  /** Scenarios this check can say nothing about at all. */
  hidden: number;
  hiddenTitles: string[];
}

/**
 * A scenario carrying a tag from `INTENT_TAGS` but no `@unimplemented` and no
 * binding tag — a parking decision spelled in a word the checker cannot read.
 */
interface IntentTagViolation {
  feature: string;
  title: string;
  line: number;
  tags: string[];
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

/**
 * An `@scenario` that parsed as a title but does not sit immediately above an
 * `it(` / `test(` call, so it binds nothing.
 *
 * This used to be dropped on the floor, and that silence is how a scenario ends
 * up reported as covered by a test that never runs for it: the annotation looks
 * like a binding in the file, the checker never counts it, and the feature's
 * scenario is only "bound" if some OTHER test happens to carry the same title.
 * Two real cases (a whole feature file's only two binders, plus three more)
 * lived that way. An annotation that does nothing is worse than a missing one,
 * because a missing one fails loudly — so this is fatal.
 */
interface DanglingAnnotation {
  title: string;
  ref: BindingRef;
}

export function parseFeature(absPath: string): Scenario[] {
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
    // The annotation may sit inside a multi-line JSDoc, in which case the scan
    // starts at the end of its own line and the next thing it meets is the
    // block's own `*/`. Stepping over it is what lets
    //
    //   /**
    //    * why this test exists
    //    * @scenario "…"
    //    */
    //   it("…")
    //
    // bind at all — without this, an annotation written in the natural JSDoc
    // style bound NOTHING even when it sat directly above its test. An earlier
    // @scenario in the same block still does not bind, because what follows it
    // is more annotation text rather than a test call.
    if (ch === "*" && src[i + 1] === "/") {
      i += 2;
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

/**
 * Every `@scenario` in the TS/TSX test roots, split by whether it actually
 * binds. `dangling` is the set that parsed as a title but sits above something
 * that is not a test call — most often a `describe(`, which reads exactly like
 * a binding and does nothing.
 */
export function collectAllBindings(testRoots: string[]): {
  bindings: CollectedBinding[];
  dangling: DanglingAnnotation[];
} {
  const bindings: CollectedBinding[] = [];
  const dangling: DanglingAnnotation[] = [];
  const files: string[] = [];
  for (const r of testRoots) {
    files.push(
      ...walkFiles(resolve(REPO_ROOT, r), (n) => TEST_FILE_RE.test(n)),
    );
  }

  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    if (ANNOTATION_SCAN_EXCLUDED_FILES.includes(rel)) continue;
    const src = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    ANNOTATION_RE.lastIndex = 0;
    while ((m = ANNOTATION_RE.exec(src)) !== null) {
      const title = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      if (!title) continue;
      const line = src.slice(0, m.index).split("\n").length;
      const ref = { file: rel, line };
      if (!isFollowedByTestCall(src, m.index + m[0].length)) {
        dangling.push({ title, ref });
        continue;
      }
      bindings.push({ title, ref });
    }
  }

  return { bindings, dangling };
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

function collectBatsBindings(testRoots: string[]): CollectedBinding[] {
  const bindings: CollectedBinding[] = [];
  const files: string[] = [];
  for (const r of testRoots) {
    files.push(
      ...walkFiles(resolve(REPO_ROOT, r), (n) => BATS_FILE_RE.test(n)),
    );
  }

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const m = line.match(BATS_ANNOTATION_RE);
      if (!m) continue;
      const title = (m[1] ?? m[2] ?? "").trim();
      if (!title) continue;
      if (!isNextLineBatsTest(lines, i + 1)) continue;
      bindings.push({
        title,
        ref: { file: relative(REPO_ROOT, file), line: i + 1 },
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
    hiddenScenarios: allScenarios.filter(isHidden),
  };
}

/**
 * A scenario this check can say nothing about: no binding tag, and no
 * `@unimplemented` either.
 *
 * Computed by filtering rather than by subtracting the two counted sets, so the
 * three states stay provably exhaustive and disjoint however the tag vocabulary
 * grows.
 */
export function isHidden(s: Pick<Scenario, "tags">): boolean {
  return (
    !s.tags.some((t) => BOUND_TAGS.has(t)) &&
    !s.tags.includes(UNIMPLEMENTED_TAG)
  );
}

/**
 * Scenarios that spell a parking decision in a word the checker cannot read.
 *
 * Only HIDDEN scenarios can violate: a scenario that carries `@planned` next to
 * `@unimplemented`, or next to `@unit`, has given a verdict this check counts,
 * and the extra word is then just a human note.
 */
export function findIntentTagViolations({
  feature,
  scenarios,
  enforcedTags,
}: {
  feature: string;
  scenarios: Scenario[];
  enforcedTags: readonly string[];
}): IntentTagViolation[] {
  const enforced = new Set(enforcedTags);
  return scenarios
    .filter(isHidden)
    .map((s) => ({ s, hits: s.tags.filter((t) => enforced.has(t)) }))
    .filter((x) => x.hits.length > 0)
    .map((x) => ({
      feature,
      title: x.s.title,
      line: x.s.line,
      tags: x.hits,
    }));
}

/** `INTENT_TAGS` minus the ones still ratcheted through `LEGACY_INTENT_TAGS`. */
export function enforcedIntentTags({
  all = INTENT_TAGS,
  tolerated = LEGACY_INTENT_TAGS,
}: {
  all?: readonly string[];
  tolerated?: readonly string[];
} = {}): string[] {
  const skip = new Set(tolerated);
  return all.filter((t) => !skip.has(t));
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

/**
 * The floor under the `✓ all bound` trap one level down: a file that enforces
 * SOME of its scenarios while the rest are neither tagged nor `@unimplemented`.
 *
 * Deliberately disjoint from `isInert`. A file enforcing nothing at all is the
 * inert case and belongs to that ratchet; this one is about the file that has
 * bought itself a clean bill of health with a single tag.
 */
export function isPartiallyInert(
  r: Pick<Report, "scenarios" | "hiddenScenarios">,
): boolean {
  return r.scenarios.length > 0 && r.hiddenScenarios.length > 0;
}

function toInertReport(r: Report): InertReport {
  return {
    feature: r.feature,
    totalScenarios: r.totalScenarios,
    unimplemented: r.unimplementedScenarios,
  };
}

function toPartiallyInertReport(r: Report): PartiallyInertReport {
  return {
    feature: r.feature,
    totalScenarios: r.totalScenarios,
    enforced: r.scenarios.length,
    unimplemented: r.unimplementedScenarios,
    hidden: r.hiddenScenarios.length,
    hiddenTitles: r.hiddenScenarios.map((s) => s.title),
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

  // `✓ all bound` must never be printed over hidden scenarios. "All" means all
  // the file declares, not all the ones that happened to be tagged.
  const hidden = r.hiddenScenarios.length;

  if (r.unbound.length === 0) {
    console.log(
      hidden === 0
        ? `  ✓ all bound`
        : `  ✓ all tagged scenarios bound — but ${hidden} of ${r.totalScenarios} scenario(s) are neither tagged nor @unimplemented`,
    );
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

function printPartiallyInertSummary(reports: PartiallyInertReport[]): void {
  if (reports.length === 0) return;
  const hidden = reports.reduce((s, r) => s + r.hidden, 0);
  console.log(
    `\nPartially inert (some scenarios enforced, rest unmeasured — tolerated via LEGACY_PARTIALLY_INERT):`,
  );
  console.log(
    `  ${reports.length} file(s) hide ${hidden} scenario(s) behind their tagged siblings.`,
  );
  for (const r of [...reports].sort((a, b) => b.hidden - a.hidden)) {
    console.log(
      `  · ${r.feature}  ${r.enforced}/${r.totalScenarios} enforced, ${r.hidden} hidden`,
    );
  }
  console.log(
    `  Tag them @unit/@integration to measure them, or @unimplemented to declare the gap. See dev/docs/TESTING_PHILOSOPHY.md.`,
  );
}

function printNewPartiallyInert(reports: PartiallyInertReport[]): void {
  if (reports.length === 0) return;
  console.log(`\nFeature files that leave some scenarios unmeasured:`);
  for (const r of reports) {
    console.log(`  ✗ ${r.feature}`);
    console.log(
      `      ${r.enforced} of ${r.totalScenarios} scenario(s) enforced, ${r.unimplemented} @unimplemented — ${r.hidden} carry neither:`,
    );
    for (const t of r.hiddenTitles) console.log(`        · ${t}`);
    console.log(
      `      Tag each @unit / @integration / @e2e / @regression and bind it, or @unimplemented to declare the gap.`,
    );
  }
}

function printIntentTagViolations(violations: IntentTagViolation[]): void {
  if (violations.length === 0) return;
  console.log(
    `\nScenarios parked with a tag this check does not recognise (use @unimplemented):`,
  );
  for (const v of violations) {
    console.log(`  ✗ ${v.tags.join(" ")} ${v.title}`);
    console.log(`    ${v.feature}:${v.line}`);
  }
  console.log(
    `    ${UNIMPLEMENTED_TAG} is the only spelling this check counts as "parked". Keep the other tag as a human note if it says something extra, but add ${UNIMPLEMENTED_TAG} alongside it.`,
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

function printDanglingAnnotations(dangling: DanglingAnnotation[]): void {
  if (dangling.length === 0) return;
  console.log(
    `\nAnnotations that bind nothing (an @scenario must sit immediately above an it( / test( call):`,
  );
  for (const a of dangling) {
    console.log(`  ✗ @scenario ${a.title}`);
    console.log(`    ${a.ref.file}:${a.ref.line}`);
  }
  console.log(
    `    Move each onto the it( it describes — above a describe( it is inert, and the scenario reads as covered by nothing.`,
  );
  console.log(
    `    In a multi-line JSDoc only the LAST @scenario binds, so give each one its own block.`,
  );
  console.log(
    `    If the text is prose that merely mentions a scenario, drop the @scenario marker.`,
  );
}

function printStaleInertAnnotations(
  stale: readonly { file: string; title: string }[],
): void {
  if (stale.length === 0) return;
  console.log(
    `\nLEGACY_INERT_ANNOTATIONS entries that no longer match anything (the annotation was fixed or moved — remove the entry):`,
  );
  for (const e of stale) {
    console.log(`  ✗ ${e.file} — "${e.title}"`);
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

function main(): void {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");

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
    ...validateExemptionList({
      name: "LEGACY_PARTIALLY_INERT",
      entries: LEGACY_PARTIALLY_INERT,
      allFeatures,
    }),
    // A tolerated tag that is not an intent tag exempts nothing, because
    // nothing was enforcing it in the first place. Left unchecked the entry
    // reads like debt being carried while the tag it names is unpoliced —
    // which is how dropping a tag from INTENT_TAGS could go unnoticed.
    ...LEGACY_INTENT_TAGS.filter((t) => !INTENT_TAGS.includes(t)).map(
      (t) =>
        `LEGACY_INTENT_TAGS entry is not listed in INTENT_TAGS, so it tolerates nothing: ${t}`,
    ),
  ];

  const { bindings: tsBindings, dangling: allDangling } =
    collectAllBindings(DEFAULT_TEST_ROOTS);
  // Split the ratchet: only annotations that are NOT already listed are fatal.
  const danglingAnnotations = allDangling.filter(
    (a) => !isLegacyInertAnnotation(a),
  );
  // An entry that no longer matches anything has been fixed — the ratchet only
  // turns one way, so the entry must come off the list rather than sit there
  // exempting a defect that no longer exists (and silently re-exempting one
  // that comes back under the same name).
  const staleInertAnnotations = LEGACY_INERT_ANNOTATIONS.filter(
    (e) =>
      !allDangling.some((a) => a.ref.file === e.file && a.title === e.title),
  );
  const bindings = [
    ...tsBindings,
    ...collectBatsBindings(DEFAULT_BATS_TEST_ROOTS),
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

  // Legacy-list hygiene: every entry must still have at least one unbound
  // scenario. If a file is fully bound, it must be removed from the list.
  const staleLegacy = legacy.filter((r) => r.unbound === 0);

  // Inert floor. A file that declares scenarios and enforces none of them is a
  // failure unless it was already in that state when the floor was introduced.
  const inertSet = new Set(LEGACY_INERT);
  const inert = enforced.filter(isInert).map(toInertReport);
  const newInert = inert.filter((r) => !inertSet.has(r.feature));
  const exemptInert = inert.filter((r) => inertSet.has(r.feature));

  // Ratchet hygiene: an entry that is no longer inert has been fixed, and must
  // leave the list so it can never silently regress.
  const inertFeatures = new Set(inert.map((r) => r.feature));
  const staleInert = LEGACY_INERT.filter(
    (f) => allFeatures.includes(f) && !inertFeatures.has(f),
  );

  // Partially-inert floor. Same shape as the inert floor one level down: a file
  // that enforces something is NOT thereby a file that enforces everything.
  const partiallyInertSet = new Set(LEGACY_PARTIALLY_INERT);
  const partiallyInert = enforced
    .filter(isPartiallyInert)
    .map(toPartiallyInertReport);
  const newPartiallyInert = partiallyInert.filter(
    (r) => !partiallyInertSet.has(r.feature),
  );
  const exemptPartiallyInert = partiallyInert.filter((r) =>
    partiallyInertSet.has(r.feature),
  );
  const partiallyInertFeatures = new Set(partiallyInert.map((r) => r.feature));
  const stalePartiallyInert = LEGACY_PARTIALLY_INERT.filter(
    (f) => allFeatures.includes(f) && !partiallyInertFeatures.has(f),
  );

  // Intent tags: a parking decision spelled in a word this check cannot read.
  // Scanned across EVERY discovered feature file, including legacy and inert
  // ones — those lists tolerate unbound and untagged scenarios, not a scenario
  // whose author believed they had already recorded a verdict.
  const activeIntentTags = enforcedIntentTags();
  const intentTagViolations = allFeatures.flatMap((f) =>
    findIntentTagViolations({
      feature: f,
      scenarios: parseFeature(resolve(REPO_ROOT, f)),
      enforcedTags: activeIntentTags,
    }),
  );

  // Ratchet hygiene: a tolerated intent tag with no unaccounted uses left has
  // been cleaned up, and must leave the list rather than sit there re-exempting
  // the convention the next time someone reaches for it.
  const toleratedIntentTagsInUse = new Set(
    allFeatures.flatMap((f) =>
      findIntentTagViolations({
        feature: f,
        scenarios: parseFeature(resolve(REPO_ROOT, f)),
        enforcedTags: LEGACY_INTENT_TAGS,
      }).flatMap((v) => v.tags),
    ),
  );
  const staleIntentTags = LEGACY_INTENT_TAGS.filter(
    (t) => !toleratedIntentTagsInUse.has(t),
  );

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          enforced,
          legacy,
          unknownAnnotations,
          danglingAnnotations,
          staleInertAnnotations,
          listErrors,
          staleLegacy: staleLegacy.map((r) => r.feature),
          inert: exemptInert,
          newInert,
          staleInert,
          partiallyInert: exemptPartiallyInert,
          newPartiallyInert,
          stalePartiallyInert,
          intentTagViolations,
          staleIntentTags,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("Feature-file parity check");
    console.log("=========================");
    console.log(
      `Enforced: ${enforced.length} file(s) · Legacy: ${legacy.length} file(s) · Inert: ${inert.length} file(s)`,
    );

    for (const r of enforced) printEnforcedReport(r);
    printLegacySummary(legacy);
    printInertSummary(exemptInert);
    printPartiallyInertSummary(exemptPartiallyInert);
    printNewInert(newInert);
    printNewPartiallyInert(newPartiallyInert);
    printIntentTagViolations(intentTagViolations);
    printUnknownAnnotations(unknownAnnotations);
    printDanglingAnnotations(danglingAnnotations);
    printStaleInertAnnotations(staleInertAnnotations);
  }

  const enforcedUnbound = enforced.reduce((s, r) => s + r.unbound.length, 0);
  const hasFatal =
    enforcedUnbound > 0 ||
    unknownAnnotations.length > 0 ||
    danglingAnnotations.length > 0 ||
    staleInertAnnotations.length > 0 ||
    listErrors.length > 0 ||
    staleLegacy.length > 0 ||
    newInert.length > 0 ||
    staleInert.length > 0 ||
    newPartiallyInert.length > 0 ||
    stalePartiallyInert.length > 0 ||
    intentTagViolations.length > 0 ||
    staleIntentTags.length > 0;

  if (hasFatal) {
    if (!asJson) {
      const parts: string[] = [];
      if (enforcedUnbound > 0) {
        parts.push(`${enforcedUnbound} unbound scenario(s) in enforced files`);
      }
      if (unknownAnnotations.length > 0) {
        parts.push(`${unknownAnnotations.length} unknown annotation(s)`);
      }
      if (danglingAnnotations.length > 0) {
        parts.push(
          `${danglingAnnotations.length} annotation(s) that bind nothing`,
        );
      }
      if (staleInertAnnotations.length > 0) {
        parts.push(
          `${staleInertAnnotations.length} LEGACY_INERT_ANNOTATIONS entr(ies) that no longer match anything — remove them from the list`,
        );
      }
      if (staleLegacy.length > 0) {
        parts.push(
          `${staleLegacy.length} fully-bound file(s) still in LEGACY_UNBOUND — remove them from the list: ${staleLegacy
            .map((r) => r.feature)
            .join(", ")}`,
        );
      }
      if (newInert.length > 0) {
        parts.push(
          `${newInert.length} file(s) enforce no scenario at all (nothing in them is tagged @unit/@integration/@e2e/@regression)`,
        );
      }
      if (staleInert.length > 0) {
        parts.push(
          `${staleInert.length} file(s) in LEGACY_INERT now enforce scenarios — remove them from the list: ${staleInert.join(
            ", ",
          )}`,
        );
      }
      if (newPartiallyInert.length > 0) {
        const hidden = newPartiallyInert.reduce((s, r) => s + r.hidden, 0);
        parts.push(
          `${hidden} scenario(s) across ${newPartiallyInert.length} file(s) are neither tagged @unit/@integration/@e2e/@regression nor @unimplemented`,
        );
      }
      if (stalePartiallyInert.length > 0) {
        parts.push(
          `${stalePartiallyInert.length} file(s) in LEGACY_PARTIALLY_INERT no longer hide scenarios — remove them from the list: ${stalePartiallyInert.join(
            ", ",
          )}`,
        );
      }
      if (intentTagViolations.length > 0) {
        parts.push(
          `${intentTagViolations.length} scenario(s) parked with a tag this check does not recognise — use ${UNIMPLEMENTED_TAG}`,
        );
      }
      if (staleIntentTags.length > 0) {
        parts.push(
          `${staleIntentTags.length} tag(s) in LEGACY_INTENT_TAGS are no longer used unaccounted — remove them from the list: ${staleIntentTags.join(
            ", ",
          )}`,
        );
      }
      if (listErrors.length > 0) {
        parts.push(`${listErrors.length} exemption-list error(s)`);
      }
      // The list name is already inside each message.
      for (const err of listErrors) console.error(`Exemption list: ${err}`);
      console.error(
        `FAIL: ${parts.join(
          ", ",
        )}. See spec-binding convention in dev/docs/TESTING_PHILOSOPHY.md.`,
      );
    }
    process.exit(1);
  }

  if (!asJson) {
    const enforcedTotal = enforced.reduce((s, r) => s + r.scenarios.length, 0);
    const legacyUnbound = legacy.reduce((s, r) => s + r.unbound, 0);
    console.log(
      `\nOK: ${enforcedTotal} enforced scenario(s) bound across ${enforced.length} file(s).`,
    );
    if (legacy.length > 0) {
      console.log(
        `    ${legacyUnbound} unbound scenario(s) tolerated in ${legacy.length} legacy file(s).`,
      );
    }
    if (exemptInert.length > 0) {
      const invisible = exemptInert.reduce((s, r) => s + r.totalScenarios, 0);
      console.log(
        `    ${exemptInert.length} file(s) exempted via LEGACY_INERT enforce nothing at all — ${invisible} scenario(s) are invisible to this check.`,
      );
    }
    if (exemptPartiallyInert.length > 0) {
      const hidden = exemptPartiallyInert.reduce((s, r) => s + r.hidden, 0);
      console.log(
        `    ${exemptPartiallyInert.length} file(s) exempted via LEGACY_PARTIALLY_INERT enforce only some of their scenarios — ${hidden} more are invisible to this check.`,
      );
    }
  }
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
