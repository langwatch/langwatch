package a2aproxy

import (
	"mime"
	"net/http"
	"strings"
)

// keptResponseHeaders are the only upstream headers that reach the caller.
// Anything else (CORS grants, WWW-Authenticate, cookies, hop-by-hop headers)
// would speak for the gateway's own address, shared by every target.
var keptResponseHeaders = map[string]bool{
	"Content-Type":     true,
	"Cache-Control":    true,
	"Retry-After":      true,
	"A2a-Version":      true,
	"A2a-Extensions":   true,
	"X-A2a-Extensions": true,
}

// copyHeader copies the allowed upstream response headers for the caller. A
// reply that is neither JSON nor an event stream is sent as JSON, so the
// gateway never serves an upstream's HTML as its own page.
func copyHeader(dst, src http.Header) {
	for k, vs := range src {
		if key := http.CanonicalHeaderKey(k); keptResponseHeaders[key] {
			dst[key] = append([]string(nil), vs...)
		}
	}
	if !servableContentType(dst.Get("Content-Type")) {
		dst.Set("Content-Type", "application/json")
	}
	dst.Set("X-Content-Type-Options", "nosniff")
}

// isEventStream reports whether a Content-Type names an SSE stream, in any case.
func isEventStream(v string) bool {
	media, _, err := mime.ParseMediaType(v)
	return err == nil && media == "text/event-stream"
}

func servableContentType(v string) bool {
	media, _, err := mime.ParseMediaType(v)
	if err != nil {
		return false
	}
	return media == "text/event-stream" || media == "application/json" ||
		(strings.HasPrefix(media, "application/") && strings.HasSuffix(media, "+json"))
}
