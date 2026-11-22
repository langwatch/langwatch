package render

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

const queryMaskingFile = "query-masking.yaml"

// renderQueryMasking hides each masked setting's value wherever ClickHouse
// logs query text: the server log, system.text_log and system.query_log.query.
// query_log's Settings column is not masked; the user's profile turns it off.
// Each rule has its own element name: a plain `rule` list in an operator's
// later config.d file would replace a `rule` list of ours when files merge.
func renderQueryMasking(input *config.Input, configD string) error {
	rules := map[string]any{}
	for _, name := range input.MaskedSettings {
		for i, r := range maskingRules(name) {
			rules[fmt.Sprintf("rule_chs_%s_%d", name, i+1)] = r
		}
	}
	if input.MaskSHA256Hex {
		rules["rule_chs_sha256_hex"] = sha256HexRule
	}
	return writeYAML(filepath.Join(configD, queryMaskingFile), map[string]any{
		"query_masking_rules": rules,
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
// the value a string with \' or ” escapes, a $$heredoc$$ or a bare token),
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
