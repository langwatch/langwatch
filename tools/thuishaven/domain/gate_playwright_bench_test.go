package domain

import "testing"

// PlaywrightRefusal runs on every Bash call the gate sees, so its cost is per command.
func BenchmarkPlaywrightRefusalOrdinaryBash(b *testing.B) {
	command := "cd apps/ui && pnpm --filter @langwatch/ui test src/foo.test.ts 2>&1 | tail -20 && git status --short"
	b.ReportAllocs()
	for b.Loop() {
		if _, refused := PlaywrightRefusal("Bash", command); refused {
			b.Fatal("refused an ordinary command")
		}
	}
}

func BenchmarkPlaywrightRefusalPlaywrightOpen(b *testing.B) {
	b.ReportAllocs()
	for b.Loop() {
		if _, refused := PlaywrightRefusal("Bash", "npx -y playwright open http://localhost:5560"); !refused {
			b.Fatal("let playwright open through")
		}
	}
}

func BenchmarkPlaywrightRefusalOtherTool(b *testing.B) {
	b.ReportAllocs()
	for b.Loop() {
		if _, refused := PlaywrightRefusal("Edit", ""); refused {
			b.Fatal("refused Edit")
		}
	}
}
