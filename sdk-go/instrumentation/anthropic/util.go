package anthropic

import "strings"

// isMessagesPath reports whether an Anthropic request path targets the Messages
// API (/v1/messages). The check is suffix/segment based so it also matches
// proxied or versioned variants (e.g. a gateway prefix).
func isMessagesPath(urlPath string) bool {
	trimmed := strings.TrimRight(urlPath, "/")
	if strings.HasSuffix(trimmed, "/v1/messages") || trimmed == "/v1/messages" {
		return true
	}
	// Fall back to a segment match so /messages behind a proxy prefix still hits.
	return strings.HasSuffix(trimmed, "/messages")
}
