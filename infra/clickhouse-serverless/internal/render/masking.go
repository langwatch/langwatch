package render

import (
	"path/filepath"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

const queryMaskingFile = "query-masking.yaml"

// renderQueryMasking hides each masked setting's value wherever ClickHouse
// logs query text: the server log, system.text_log and system.query_log.query.
// query_log's Settings column is not masked; the user's profile turns it off.
func renderQueryMasking(input *config.Input, configD string) error {
	rules := make([]map[string]any, 0, 3*len(input.MaskedSettings))
	for _, name := range input.MaskedSettings {
		rules = append(rules, maskingRules(name)...)
	}
	if input.MaskSHA256Hex {
		rules = append(rules, sha256HexRule)
	}
	return writeYAML(filepath.Join(configD, queryMaskingFile), map[string]any{
		"query_masking_rules": map[string]any{"rule": rules},
	})
}

// sha256HexRule hides a sha256 in hex anywhere, e.g. a folded constant in a
// Debug line such as the query condition cache's `has(['<hash>'], KeyHash)`.
var sha256HexRule = map[string]any{
	"name":    "hide sha256 hex values",
	"regexp":  `(?i)\b[0-9a-f]{64}\b`,
	"replace": "[HIDDEN]",
}

// gap is what may sit around `=`: whitespace and /* comments */.
const gap = `(?:\s|/\*.*?\*/)*`

// maskingRules hide name's value in a statement (the name optionally quoted;
// the value a string with \' or '' escapes, a $$heredoc$$ or a bare token),
// and in a URL parameter, plain or percent-encoded.
func maskingRules(name string) []map[string]any {
	return []map[string]any{
		{
			"name":    "hide " + name + " in a statement",
			"regexp":  `(?i)[\x60"]?\b(` + name + `)\b[\x60"]?` + gap + `=` + gap + `(?:'(?:[^'\\]|\\.|'')*'|\$\$.*?\$\$|[^\s,;)]+)`,
			"replace": `\1 = '[HIDDEN]'`,
		},
		{
			"name":    "hide " + name + " in a URL",
			"regexp":  `(?i)\b(` + name + `)=[^&\s"]*`,
			"replace": `\1=[HIDDEN]`,
		},
		{
			"name":    "hide " + name + " in an encoded URL",
			"regexp":  `(?i)\b(` + name + `)(?:%20|\+)*%3D[^&\s"]*`,
			"replace": `\1%3D[HIDDEN]`,
		},
	}
}
