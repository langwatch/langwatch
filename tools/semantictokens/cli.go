package semantictokens

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

// DefaultRoot is the tree the check owns.
const DefaultRoot = "platform/app/src"

// IgnoreMarker suppresses the finding on the line it appears on, or on the line
// after it. Use it where a raw shade is deliberate and say why in the same
// comment — a marker with no reason beside it is worse than the raw shade.
const IgnoreMarker = "semantic-tokens-ignore"

// ExemptDirs are trees whose colors are not app surfaces at all.
var ExemptDirs = []string{
	"components/icons", // third-party brand marks, fixed by the brand
	"server/mailer",    // email HTML, which has no CSS custom properties
}

// ExemptFiles name their reason. Each must exist: a stale entry fails the
// check, so the list cannot quietly outlive the file it excuses.
var ExemptFiles = map[string]string{
	// These define the tokens. A token has to resolve to a shade somewhere.
	"pages/_app.tsx":               "defines the semantic tokens",
	"features/langy/langyTheme.ts": "defines Langy's palette on the shared tokens",
	"features/asaplangy/tokens.ts": "defines the asaplangy tokens",

	// Fixed-palette surfaces: dark in BOTH color modes, so their light-on-dark
	// text is already correct and a mode-flipping token would invert it.
	"components/simulations/simulation-console/constants.ts":          "fixed-dark console palette",
	"components/simulations/simulation-console/StatusDisplay.tsx":     "fixed-dark console palette",
	"components/simulations/simulation-console/SimulationConsole.tsx": "fixed-dark console chrome",
	"components/analytics/reports/GraphFilterIndicator.tsx":           "tooltip forced black in both modes",
	"components/HoverableBigText.tsx":                                 "tooltip forced black in both modes",

	// Categorical identity palettes: the color names the thing (a feature, a
	// span type, a syntax token) rather than theming a surface.
	"utils/featureIcons.ts":                                             "one canonical color per feature",
	"features/command-bar/constants.ts":                                 "one canonical color per command",
	"features/command-bar/getIconInfo.ts":                               "reads the command-bar palette",
	"components/llmPromptConfigs/parameterRegistry.ts":                  "one canonical color per parameter",
	"utils/rotatingColors.ts":                                           "deterministic per-string chart colors",
	"hooks/useGetRotatingColorForCharts.tsx":                            "reads the rotating chart palette",
	"features/traces-v2/utils/ansi/ansi.ts":                             "ANSI terminal palette",
	"features/traces-v2/components/TraceDrawer/terminalView/palette.ts": "ANSI terminal palette",
	"features/traces-v2/components/ai/aiBrandPalette.ts":                "AI brand marks",

	// Already an explicit light/dark pair, which is what a token would give it.
	"features/onboarding/components/sections/shared/accent-surface.ts": "explicit light/dark pair",
}

func isExemptDir(rel string) bool {
	for _, d := range ExemptDirs {
		if strings.HasPrefix(rel, d+"/") {
			return true
		}
	}
	return false
}

func isTestPath(rel string) bool {
	return strings.Contains(rel, "__tests__") ||
		strings.HasSuffix(rel, ".test.ts") || strings.HasSuffix(rel, ".test.tsx")
}

// suppressed reports whether the ignore marker covers this line: either on the
// line itself, or anywhere in the contiguous comment block directly above it.
// The block walk matters because the reason usually needs more than one line,
// and the marker belongs at the top of the explanation, not buried next to the
// prop.
func suppressed(lines []string, line int) bool {
	i := line - 1
	if i < 0 || i >= len(lines) {
		return false
	}
	if strings.Contains(lines[i], IgnoreMarker) {
		return true
	}
	for i--; i >= 0; i-- {
		trimmed := strings.TrimSpace(lines[i])
		if !strings.HasPrefix(trimmed, "//") && !strings.HasPrefix(trimmed, "*") &&
			!strings.HasPrefix(trimmed, "/*") {
			return false
		}
		if strings.Contains(trimmed, IgnoreMarker) {
			return true
		}
	}
	return false
}

// scannable reports whether this path is app source the check owns.
func scannable(rel string) bool {
	if ext := path.Ext(rel); ext != ".ts" && ext != ".tsx" {
		return false
	}
	if isTestPath(rel) || isExemptDir(rel) {
		return false
	}
	_, exempt := ExemptFiles[rel]
	return !exempt
}

// findingsIn returns one file's unsuppressed findings.
func findingsIn(rel, src string) []Finding {
	lines := strings.Split(src, "\n")
	var out []Finding
	for _, f := range ScanSource(rel, src) {
		if !suppressed(lines, f.Line) {
			out = append(out, f)
		}
	}
	return out
}

// Scan walks root and returns every finding that is not exempt or suppressed.
// The walk is rooted with os.Root so a symlink cannot escape the tree.
func Scan(root string) ([]Finding, error) {
	dir, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer func() { _ = dir.Close() }()

	var out []Finding
	walkErr := fs.WalkDir(dir.FS(), ".", func(rel string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !scannable(rel) {
			return err
		}
		raw, readErr := dir.ReadFile(rel)
		if readErr != nil {
			return readErr
		}
		out = append(out, findingsIn(rel, string(raw))...)
		return nil
	})
	return out, walkErr
}

// staleExemptions returns exempt paths that no longer exist.
func staleExemptions(root string) []string {
	var stale []string
	for rel := range ExemptFiles {
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel))); err != nil {
			stale = append(stale, rel)
		}
	}
	sort.Strings(stale)
	return stale
}

// output is where the command writes. Grouped so report stays within the
// argument limit and so tests can capture both streams as one value.
type output struct{ stdout, stderr io.Writer }

// report prints the human-readable verdict and returns the exit code.
func (o output) report(findings []Finding, stale []string) int {
	for _, rel := range stale {
		fmt.Fprintf(o.stderr, "stale exemption: %s no longer exists — drop it from ExemptFiles\n", rel)
	}
	if len(findings) == 0 && len(stale) == 0 {
		fmt.Fprintln(o.stdout, "no raw palette shades in color props")
		return 0
	}
	for _, f := range findings {
		fmt.Fprintln(o.stdout, f.String())
	}
	if len(findings) > 0 {
		fmt.Fprintf(o.stderr, "\n%d raw palette shade(s) in color props.\n", len(findings))
		fmt.Fprintf(o.stderr, "A raw shade is fixed in both color modes, so it reads correctly in one\n"+
			"and goes unreadable in the other. Use the token shown beside each line.\n"+
			"If the surface really is fixed in both modes, add a %q comment saying why.\n", IgnoreMarker)
	}
	return 1
}

// Run is the command. Exit 1 on findings, 2 on a usage or walk error.
func Run(args []string, stdout, stderr io.Writer) int {
	fset := flag.NewFlagSet("semantictokens", flag.ContinueOnError)
	fset.SetOutput(stderr)
	root := fset.String("root", DefaultRoot, "tree to scan")
	asJSON := fset.Bool("json", false, "emit findings as JSON and exit 0")
	// Only meaningful against the real tree: the exemption list is written for
	// it, so a synthetic root would report every entry as stale.
	verifyExemptions := fset.Bool("verify-exemptions", true,
		"fail when an exempt path no longer exists")
	if err := fset.Parse(args); err != nil {
		return 2
	}

	findings, err := Scan(*root)
	if err != nil {
		fmt.Fprintf(stderr, "semantictokens: %v\n", err)
		return 2
	}

	if *asJSON {
		if findings == nil {
			findings = []Finding{}
		}
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		if encErr := enc.Encode(findings); encErr != nil {
			fmt.Fprintf(stderr, "semantictokens: %v\n", encErr)
			return 2
		}
		return 0
	}

	var stale []string
	if *verifyExemptions {
		stale = staleExemptions(*root)
	}
	return output{stdout, stderr}.report(findings, stale)
}
