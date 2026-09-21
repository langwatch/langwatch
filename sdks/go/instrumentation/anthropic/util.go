package anthropic

import "strings"

// isMessagesPath reports whether an Anthropic request path targets the Messages
// API (/v1/messages). It matches on the final segment rather than the full
// "/v1/messages" path so proxied and version-prefixed variants (a gateway
// prefix, a different API version) still hit.
func isMessagesPath(urlPath string) bool {
	return strings.HasSuffix(strings.TrimRight(urlPath, "/"), "/messages")
}
