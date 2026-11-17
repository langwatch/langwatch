package a2aproxy

import (
	"net/http"
	"strings"
)

// droppedResponseHeaders never reach the caller. The hop-by-hop set (RFC 9110
// section 7.6.1) belongs to the upstream connection. Set-Cookie is dropped
// because the gateway is not the agent's origin: a cookie the agent sets would
// land on the gateway host, shared by every caller of every target.
var droppedResponseHeaders = map[string]bool{
	"Connection":          true,
	"Keep-Alive":          true,
	"Proxy-Authenticate":  true,
	"Proxy-Authorization": true,
	"Proxy-Connection":    true,
	"Te":                  true,
	"Trailer":             true,
	"Transfer-Encoding":   true,
	"Upgrade":             true,
	"Content-Length":      true,
	"Set-Cookie":          true,
	"Set-Cookie2":         true,
}

// copyHeader copies an upstream response's headers for the caller, minus the
// dropped set and every header the upstream's Connection header names.
func copyHeader(dst, src http.Header) {
	named := map[string]bool{}
	for _, v := range src.Values("Connection") {
		for _, name := range strings.Split(v, ",") {
			if name = strings.TrimSpace(name); name != "" {
				named[http.CanonicalHeaderKey(name)] = true
			}
		}
	}
	for k, vs := range src {
		key := http.CanonicalHeaderKey(k)
		if droppedResponseHeaders[key] || named[key] {
			continue
		}
		dst[key] = append([]string(nil), vs...)
	}
}
