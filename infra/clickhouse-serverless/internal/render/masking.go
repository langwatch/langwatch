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
	rules := make([]map[string]any, 0, len(input.MaskedSettings))
	for _, name := range input.MaskedSettings {
		rules = append(rules, map[string]any{
			"name":    "hide " + name,
			"regexp":  `(?i)\b(` + name + `)\s*=\s*'[^']*'`,
			"replace": `\1 = '[HIDDEN]'`,
		})
	}
	return writeYAML(filepath.Join(configD, queryMaskingFile), map[string]any{
		"query_masking_rules": map[string]any{"rule": rules},
	})
}
