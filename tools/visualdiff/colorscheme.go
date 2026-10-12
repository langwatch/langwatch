package visualdiff

import "fmt"

// ColorScheme is the colour scheme a run's pages render in. Both captures every screen twice,
// the dark pass under keys that end in "@dark" (runner/src/color-scheme.ts), so the two never
// share a baseline slot or a screenshot file.
type ColorScheme string

// The colour schemes a run can render in; SchemeBoth captures each screen twice.
const (
	SchemeLight ColorScheme = "light"
	SchemeDark  ColorScheme = "dark"
	SchemeBoth  ColorScheme = "both"
)

// ParseColorScheme reads -color-scheme; empty is light.
func ParseColorScheme(value string) (ColorScheme, error) {
	switch scheme := ColorScheme(value); scheme {
	case "", SchemeLight:
		return SchemeLight, nil
	case SchemeDark, SchemeBoth:
		return scheme, nil
	}
	return "", fmt.Errorf("color scheme %q: want light, dark or both", value)
}

// isLight is the default, which leaves every existing baseline key and plan unchanged.
func (scheme ColorScheme) isLight() bool { return scheme == "" || scheme == SchemeLight }
