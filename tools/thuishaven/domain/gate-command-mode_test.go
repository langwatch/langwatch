package domain

import "testing"

func TestGateLeavesLongLivedAndInformationalCommandsDirect(t *testing.T) {
	for _, command := range []string{
		"pnpm exec tsc --watch",
		"pnpm exec tsc -w",
		"cd apps/ui && pnpm exec tsc --watch",
		"pnpm exec vitest --watch",
		"pnpm exec tsc --watch=true",
		"tsgo --lsp",
		"pnpm exec tsc --help",
		"pnpm exec tsc --version",
	} {
		t.Run(command, func(t *testing.T) {
			if _, heavy := ClassifyCommand(command); heavy {
				t.Fatalf("long-lived or informational command must stay direct: %s", command)
			}
		})
	}
}

func TestGateStillCountsFiniteChecks(t *testing.T) {
	for _, command := range []string{
		"pnpm exec tsc --noEmit -p tsconfig.json",
		"pnpm exec vitest run",
		"pnpm -w typecheck",
		"go build -v ./cmd/haven",
		"pnpm exec vitest --watch=false",
		"tsc --version && pnpm typecheck",
		"tsc --version;pnpm typecheck",
	} {
		t.Run(command, func(t *testing.T) {
			if _, heavy := ClassifyCommand(command); !heavy {
				t.Fatalf("finite check must use admission: %s", command)
			}
		})
	}
}
