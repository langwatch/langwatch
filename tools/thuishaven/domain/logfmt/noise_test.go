package logfmt

import "testing"

// TestMuted_DropsThePrismaBanner pins the two lines Prisma prints on every
// generate, dimmed, one of them on stderr, with no flag to turn either off.
//
/** @scenario "The codegen lane prints what a generator did, not what it loaded" */
func TestMuted_DropsThePrismaBanner(t *testing.T) {
	for _, line := range []string{
		"Loaded Prisma config from prisma.config.ts.",
		"\x1b[2mLoaded Prisma config from prisma.config.ts.\x1b[22m",
		"Prisma schema loaded from prisma/schema.prisma",
		"",
		"   ",
	} {
		if !Muted("codegen", line) {
			t.Errorf("Muted(codegen, %q) = false, want true", line)
		}
	}
}

// TestMuted_KeepsWhatTheGeneratorDid pins the line the lane exists to show.
//
/** @scenario "The codegen lane prints what a generator did, not what it loaded" */
func TestMuted_KeepsWhatTheGeneratorDid(t *testing.T) {
	for _, line := range []string{
		"✔ Generated Prisma Client (v7.9.1) to ./src/generated/client in 421ms",
		"Generated 7 setup skill bodies (137 kB)",
		`{"level":"error","msg":"seed failed"}`,
	} {
		if Muted("codegen", line) {
			t.Errorf("Muted(codegen, %q) = true, want false", line)
		}
	}
}

// TestMuted_LeavesServiceLanesAlone pins the scope: a blank line from a
// service is that service's output, not haven's to remove.
//
/** @scenario "The codegen lane prints what a generator did, not what it loaded" */
func TestMuted_LeavesServiceLanesAlone(t *testing.T) {
	for _, lane := range []string{"ui", "api", "workers", "nlp"} {
		if Muted(lane, "") {
			t.Errorf("Muted(%q, blank) = true, want false", lane)
		}
		if Muted(lane, "Prisma schema loaded from prisma/schema.prisma") {
			t.Errorf("Muted(%q, banner) = true, want false", lane)
		}
	}
}

// TestIsPassthroughNoise_DropsDecorationAndWhitespace pins the lines that
// carry nothing once a tool's own framing is stripped away, for every lane -
// unlike Muted, which only applies to the one-shot ones.
func TestIsPassthroughNoise_DropsDecorationAndWhitespace(t *testing.T) {
	for _, line := range []string{
		"",
		"   ",
		"\x1b[2m\x1b[22m",
		"────────────────",
		"═══ ═══",
		"  •  ",
	} {
		if !isPassthroughNoise(line) {
			t.Errorf("isPassthroughNoise(%q) = false, want true", line)
		}
	}
}

// TestIsPassthroughNoise_KeepsWordsUnderTheirOwnDecoration pins that a line
// carrying real words is never dropped just because it is also dimmed or
// bordered.
func TestIsPassthroughNoise_KeepsWordsUnderTheirOwnDecoration(t *testing.T) {
	for _, line := range []string{
		"exited — restarting in 1s",
		"── build ──",
		"\x1b[2mLoaded Prisma config from prisma.config.ts.\x1b[22m",
	} {
		if isPassthroughNoise(line) {
			t.Errorf("isPassthroughNoise(%q) = true, want false", line)
		}
	}
}

// TestViteReadyMessage_CollapsesTheStartupLine pins the transform: Vite's own
// spelling and spacing becomes the shared format's, in lowercase.
func TestViteReadyMessage_CollapsesTheStartupLine(t *testing.T) {
	got, ok := viteReadyMessage("VITE v8.1.2  ready in 1814 ms")
	if !ok {
		t.Fatal("viteReadyMessage() ok = false, want true")
	}
	if want := "vite 8.1.2 ready in 1814 ms"; got != want {
		t.Errorf("viteReadyMessage() = %q, want %q", got, want)
	}
}

// TestIsViteBannerNoise_MatchesTheLinesAfterReady pins the banner lines that
// follow Vite's ready line, which haven covers another way and so drops.
func TestIsViteBannerNoise_MatchesTheLinesAfterReady(t *testing.T) {
	for _, line := range []string{
		"➜  Local:   https://app.langwatch.localhost/",
		"➜  Network: use --host to expose",
		"➜  press h + enter to show help",
		"press h + enter to show help",
	} {
		if !isViteBannerNoise(line) {
			t.Errorf("isViteBannerNoise(%q) = false, want true", line)
		}
	}
	if isViteBannerNoise("VITE v8.1.2  ready in 1814 ms") {
		t.Error("isViteBannerNoise(ready line) = true, want false")
	}
}
