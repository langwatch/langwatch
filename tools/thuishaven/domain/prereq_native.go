package domain

import "path/filepath"

// NativePinnedBinary is one release the native macOS tier downloads itself,
// at the path the adapter that runs it looks first.
type NativePinnedBinary struct {
	Name     string
	Version  string
	Artifact PinnedArtifact
	Dest     string
}

// ClickHouseNativeBinary is where the pinned ClickHouse lives under the native
// server's directory (havenHome/ClickHouseNativeDir).
func ClickHouseNativeBinary(dir string) string {
	return filepath.Join(dir, "bin", ClickHouseNativeVersion, "clickhouse")
}

// NativePinnedBinaries lists the pinned downloads for a machine: ClickHouse,
// Tempo and Alloy on macOS, nothing where haven pins none.
func NativePinnedBinaries(havenHome, goos, goarch string) []NativePinnedBinary {
	var out []NativePinnedBinary
	if a, ok := ClickHouseNativeArtifactFor(goos, goarch); ok {
		out = append(out, NativePinnedBinary{
			Name: "clickhouse", Version: ClickHouseNativeVersion, Artifact: a,
			Dest: ClickHouseNativeBinary(filepath.Join(havenHome, ClickHouseNativeDir)),
		})
	}
	plan := NativeObservabilityPlan{Dir: filepath.Join(havenHome, "observability")}
	if a, ok := TempoNativeArtifactFor(goos, goarch); ok {
		out = append(out, NativePinnedBinary{Name: "tempo", Version: TempoNativeVersion, Artifact: a, Dest: plan.TempoBinary()})
	}
	if a, ok := AlloyNativeArtifactFor(goos, goarch); ok {
		out = append(out, NativePinnedBinary{Name: "alloy", Version: AlloyNativeVersion, Artifact: a, Dest: plan.AlloyBinary()})
	}
	return out
}

// MissingPinnedBinaries keeps the ones not on disk yet, so a re-run fetches
// nothing and reports one line.
func MissingPinnedBinaries(bins []NativePinnedBinary, exists func(path string) bool) []NativePinnedBinary {
	var out []NativePinnedBinary
	for _, b := range bins {
		if !exists(b.Dest) {
			out = append(out, b)
		}
	}
	return out
}
