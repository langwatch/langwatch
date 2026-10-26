package featureparity

// The roots and the legacy-unbound list, copied from
// packages/architecture-enforcer/src/tools/check-feature-parity.ts, which keeps
// each entry's reason. TestListsMatchNodeTool fails when the two drift. The
// per-scenario tolerance is not copied: both tools read
// packages/architecture-enforcer/src/tools/feature-parity-frozen.json.

var (
	tsTestRoots = []string{
		"packages",
		"modules",
		"enterprise",
		"apps",
		"services/langyworker/src",
		"mcp/typescript/src",
		"sdks/typescript/src",
		"sdks/typescript/__tests__",
		"sdks/python/src",
		"dev/tests",
		"plugins",
		"tools/seedgen/runner/src",
		"tools/dev-runtime/src",
		"skills/_tests",
		".github/scripts",
		"dev/scripts/__tests__",
		"dev/nx/__tests__",
		"dev/scripts/upgrade-rehearsal/__tests__",
	}
	batsTestRoots = []string{
		"dev/scripts/__tests__",
	}
	shellTestRoots = []string{
		".github/scripts/__tests__",
		"charts/langwatch/tests",
		"charts/gateway/tests",
		"charts/clickhouse-serverless/tests",
	}
	goTestRoots = []string{
		"services/nlpgo",
		"services/aigateway",
		"services/langyagent",
		"services/sims/idpsim",
		"services/sims/mailsim",
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
		"services/scenariorunner",
		"tools/workerrun",
		"tools/seedgen",
		"sdks/go",
		"pkg",
		"tools/thuishaven",
		"tools/herrgen",
		"tools/ciguard",
		"tools/migrationorder",
		"tools/linkcheck",
		"cmd/linkcheck",
		"cmd/service",
		"tools/upgradelab",
		"services/sims/telemetrysim",
		"infra/clickhouse-serverless",
	}
	pythonTestRoots = []string{
		"services/langevals",
		"sdks/python",
	}
	legacyUnbound = []string{
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
	}
)
