package render

import (
	"regexp"
	"strings"
	"testing"
)

// @scenario "A masked setting's value never reaches a log"
func TestMaskingRules_HideEverySpellingOfTheValue(t *testing.T) {
	rules := maskingRules("custom_api_key_hash")
	mask := func(in string) string {
		for _, r := range rules {
			// ClickHouse writes back-references as \1; Go's regexp as ${1}.
			repl := strings.ReplaceAll(r["replace"].(string), `\1`, "${1}")
			in = regexp.MustCompile(r["regexp"].(string)).ReplaceAllString(in, repl)
		}
		return in
	}
	for _, in := range []string{
		"SETTINGS custom_api_key_hash = 'SECRETabc'",
		"SETTINGS `custom_api_key_hash` = 'SECRETabc'",
		`SETTINGS "custom_api_key_hash"='SECRETabc'`,
		"SETTINGS CUSTOM_API_KEY_HASH='SECRETabc'",
		"SETTINGS custom_api_key_hash/**/= 'SECRETabc'",
		`SETTINGS custom_api_key_hash = 'pre\'SECRETabc'`,
		"SETTINGS custom_api_key_hash = 'pre''SECRETabc'",
		"SETTINGS custom_api_key_hash = $$SECRETabc$$",
		"SETTINGS custom_api_key_hash = SECRET123, max_threads = 1",
		"Request URI: /?custom_api_key_hash=SECRETabc&x=1",
		"Request URI: /?query=SELECT+1+SETTINGS+custom_api_key_hash%20%3D%20%27SECRETabc%27&x=1",
		"Request URI: /?query=SELECT+1+SETTINGS+custom_api_key_hash+%3D+%27SECRETabc%27",
	} {
		if out := mask(in); strings.Contains(out, "SECRET") || !strings.Contains(out, "[HIDDEN]") {
			t.Errorf("%s\n  masked to %s", in, out)
		}
	}
	if out := mask("SETTINGS max_threads = 4, custom_other = 'kept'"); !strings.Contains(out, "'kept'") {
		t.Errorf("an unlisted setting was masked: %s", out)
	}
}

// @scenario "A masked setting's value never reaches a log"
func TestSHA256HexRule_HidesAFoldedCapability(t *testing.T) {
	hash := strings.Repeat("ab12", 16)
	line := "Query condition cache has dropped 0/2 granules for PREWHERE condition has(_CAST(['" + hash + "']_Array(String)), __table1.KeyHash)."
	re := regexp.MustCompile(sha256HexRule["regexp"].(string))
	if out := re.ReplaceAllString(line, "[HIDDEN]"); strings.Contains(out, hash) {
		t.Errorf("the folded capability survived: %s", out)
	}
	if short := strings.Repeat("ab12", 12); re.MatchString(short) {
		t.Errorf("a 48-character hex value was treated as a sha256: %s", short)
	}
}
