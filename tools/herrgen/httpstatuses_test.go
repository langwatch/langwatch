package herrgen

// Internal, not herrgen_test: httpStatuses is unexported, and the whole point
// of this file is to check it against something outside the package.

import (
	"net/http"
	"testing"
)

// TestHTTPStatusesMatchNetHTTP checks herrgen's status table against the
// standard library rather than against itself.
//
// Nothing else can. Registrations are read syntactically, so `http.StatusGone`
// arrives as two identifiers and this table is what turns it into a number; the
// drift check then compares the generated artifact to the artifact, so a wrong
// number here is consistent with itself forever and ships an httpStatus into
// TypeScript that the Go service never returns.
//
// The right-hand side of every pair below is resolved by the compiler from
// net/http, so the assertion is "herrgen agrees with the standard library",
// not "the map equals the map".
// @scenario "The registered status is resolved through the net/http constant"
func TestHTTPStatusesMatchNetHTTP(t *testing.T) {
	fromNetHTTP := map[string]int{
		"StatusContinue":           http.StatusContinue,
		"StatusSwitchingProtocols": http.StatusSwitchingProtocols,
		"StatusProcessing":         http.StatusProcessing,
		"StatusEarlyHints":         http.StatusEarlyHints,

		"StatusOK":                   http.StatusOK,
		"StatusCreated":              http.StatusCreated,
		"StatusAccepted":             http.StatusAccepted,
		"StatusNonAuthoritativeInfo": http.StatusNonAuthoritativeInfo,
		"StatusNoContent":            http.StatusNoContent,
		"StatusResetContent":         http.StatusResetContent,
		"StatusPartialContent":       http.StatusPartialContent,
		"StatusMultiStatus":          http.StatusMultiStatus,
		"StatusAlreadyReported":      http.StatusAlreadyReported,
		"StatusIMUsed":               http.StatusIMUsed,

		"StatusMultipleChoices":   http.StatusMultipleChoices,
		"StatusMovedPermanently":  http.StatusMovedPermanently,
		"StatusFound":             http.StatusFound,
		"StatusSeeOther":          http.StatusSeeOther,
		"StatusNotModified":       http.StatusNotModified,
		"StatusUseProxy":          http.StatusUseProxy,
		"StatusTemporaryRedirect": http.StatusTemporaryRedirect,
		"StatusPermanentRedirect": http.StatusPermanentRedirect,

		"StatusBadRequest":                   http.StatusBadRequest,
		"StatusUnauthorized":                 http.StatusUnauthorized,
		"StatusPaymentRequired":              http.StatusPaymentRequired,
		"StatusForbidden":                    http.StatusForbidden,
		"StatusNotFound":                     http.StatusNotFound,
		"StatusMethodNotAllowed":             http.StatusMethodNotAllowed,
		"StatusNotAcceptable":                http.StatusNotAcceptable,
		"StatusProxyAuthRequired":            http.StatusProxyAuthRequired,
		"StatusRequestTimeout":               http.StatusRequestTimeout,
		"StatusConflict":                     http.StatusConflict,
		"StatusGone":                         http.StatusGone,
		"StatusLengthRequired":               http.StatusLengthRequired,
		"StatusPreconditionFailed":           http.StatusPreconditionFailed,
		"StatusRequestEntityTooLarge":        http.StatusRequestEntityTooLarge,
		"StatusRequestURITooLong":            http.StatusRequestURITooLong,
		"StatusUnsupportedMediaType":         http.StatusUnsupportedMediaType,
		"StatusRequestedRangeNotSatisfiable": http.StatusRequestedRangeNotSatisfiable,
		"StatusExpectationFailed":            http.StatusExpectationFailed,
		"StatusTeapot":                       http.StatusTeapot,
		"StatusMisdirectedRequest":           http.StatusMisdirectedRequest,
		"StatusUnprocessableEntity":          http.StatusUnprocessableEntity,
		"StatusLocked":                       http.StatusLocked,
		"StatusFailedDependency":             http.StatusFailedDependency,
		"StatusTooEarly":                     http.StatusTooEarly,
		"StatusUpgradeRequired":              http.StatusUpgradeRequired,
		"StatusPreconditionRequired":         http.StatusPreconditionRequired,
		"StatusTooManyRequests":              http.StatusTooManyRequests,
		"StatusRequestHeaderFieldsTooLarge":  http.StatusRequestHeaderFieldsTooLarge,
		"StatusUnavailableForLegalReasons":   http.StatusUnavailableForLegalReasons,

		"StatusInternalServerError":           http.StatusInternalServerError,
		"StatusNotImplemented":                http.StatusNotImplemented,
		"StatusBadGateway":                    http.StatusBadGateway,
		"StatusServiceUnavailable":            http.StatusServiceUnavailable,
		"StatusGatewayTimeout":                http.StatusGatewayTimeout,
		"StatusHTTPVersionNotSupported":       http.StatusHTTPVersionNotSupported,
		"StatusVariantAlsoNegotiates":         http.StatusVariantAlsoNegotiates,
		"StatusInsufficientStorage":           http.StatusInsufficientStorage,
		"StatusLoopDetected":                  http.StatusLoopDetected,
		"StatusNotExtended":                   http.StatusNotExtended,
		"StatusNetworkAuthenticationRequired": http.StatusNetworkAuthenticationRequired,
	}

	for name, want := range fromNetHTTP {
		got, ok := httpStatuses[name]
		if !ok {
			t.Errorf("httpStatuses is missing http.%s (%d); a registration using it stops the run", name, want)
			continue
		}
		if got != want {
			t.Errorf("httpStatuses[%q] = %d, but net/http says http.%s is %d", name, got, name, want)
		}
	}

	for name, status := range httpStatuses {
		if _, ok := fromNetHTTP[name]; !ok {
			t.Errorf("httpStatuses has %q, which this test does not check against net/http — add it above or drop it", name)
		}
		// A second, independent read of the same fact: net/http only names a
		// status it actually declares, so a plausible-looking number that is
		// not a real status is caught even if the pairing above were edited to
		// match it.
		if http.StatusText(status) == "" {
			t.Errorf("httpStatuses[%q] = %d, which net/http does not recognize as a status at all", name, status)
		}
	}
}
