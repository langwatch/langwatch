package rpc

import (
	"net/http"
	"strings"
)

// HeaderShadow marks a shadow call: the app's Go comparison beside Python's
// answer, admitted from contract.Config.ShadowMaxInFlight, not the live share.
const HeaderShadow = "X-LangWatch-Shadow"

// IsShadowCall reports whether r carries HeaderShadow set to "1" or "true".
func IsShadowCall(r *http.Request) bool {
	value := strings.TrimSpace(r.Header.Get(HeaderShadow))
	return value == "1" || strings.EqualFold(value, "true")
}
