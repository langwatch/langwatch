package enforcer

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/tools/internal/workspace"
)

func benchPolicy(b *testing.B, run func(*workspace.Snapshot) ([]Violation, error)) {
	b.Helper()
	root, _ := filepath.Abs("../..")
	if _, err := os.Stat(filepath.Join(root, "pnpm-workspace.yaml")); err != nil {
		b.Skip("no workspace")
	}
	b.ReportAllocs()
	for b.Loop() {
		s, err := workspace.Build(root)
		if err != nil {
			b.Fatal(err)
		}
		if _, err := run(s); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkUnusedModuleExport(b *testing.B) { benchPolicy(b, UnusedModuleExports) }

func BenchmarkDeclarationProjectReferences(b *testing.B) {
	benchPolicy(b, DeclarationProjectReferences)
}

func BenchmarkCycles(b *testing.B) { benchPolicy(b, Cycles) }

func BenchmarkContractBuildConfig(b *testing.B) { benchPolicy(b, ContractBuildConfigs) }

func BenchmarkBrowserNodeLeaks(b *testing.B) { benchPolicy(b, BrowserNodeLeaks) }

// BenchmarkPortedPolicies is one lint run's Go half: one snapshot, every ported policy.
func BenchmarkPortedPolicies(b *testing.B) {
	benchPolicy(b, func(s *workspace.Snapshot) ([]Violation, error) {
		var all []Violation
		for _, p := range Policies {
			if p.Run == nil {
				continue
			}
			found, err := p.Run(s)
			if err != nil {
				return nil, err
			}
			all = append(all, found...)
		}
		return all, nil
	})
}
