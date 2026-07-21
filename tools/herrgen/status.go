package herrgen

// httpStatuses maps the net/http status constant names to their numbers.
//
// Registrations are read syntactically, so `http.StatusConflict` arrives as two
// identifiers rather than the 409 the compiler would fold it into. Mirrors
// net/http's own list; a constant missing here means its registration resolves
// to no status at all, which the generated file shows as an entry with no
// httpStatus.
var httpStatuses = map[string]int{
	"StatusContinue":           100,
	"StatusSwitchingProtocols": 101,
	"StatusProcessing":         102,
	"StatusEarlyHints":         103,

	"StatusOK":                   200,
	"StatusCreated":              201,
	"StatusAccepted":             202,
	"StatusNonAuthoritativeInfo": 203,
	"StatusNoContent":            204,
	"StatusResetContent":         205,
	"StatusPartialContent":       206,
	"StatusMultiStatus":          207,
	"StatusAlreadyReported":      208,
	"StatusIMUsed":               226,

	"StatusMultipleChoices":   300,
	"StatusMovedPermanently":  301,
	"StatusFound":             302,
	"StatusSeeOther":          303,
	"StatusNotModified":       304,
	"StatusUseProxy":          305,
	"StatusTemporaryRedirect": 307,
	"StatusPermanentRedirect": 308,

	"StatusBadRequest":                   400,
	"StatusUnauthorized":                 401,
	"StatusPaymentRequired":              402,
	"StatusForbidden":                    403,
	"StatusNotFound":                     404,
	"StatusMethodNotAllowed":             405,
	"StatusNotAcceptable":                406,
	"StatusProxyAuthRequired":            407,
	"StatusRequestTimeout":               408,
	"StatusConflict":                     409,
	"StatusGone":                         410,
	"StatusLengthRequired":               411,
	"StatusPreconditionFailed":           412,
	"StatusRequestEntityTooLarge":        413,
	"StatusRequestURITooLong":            414,
	"StatusUnsupportedMediaType":         415,
	"StatusRequestedRangeNotSatisfiable": 416,
	"StatusExpectationFailed":            417,
	"StatusTeapot":                       418,
	"StatusMisdirectedRequest":           421,
	"StatusUnprocessableEntity":          422,
	"StatusLocked":                       423,
	"StatusFailedDependency":             424,
	"StatusTooEarly":                     425,
	"StatusUpgradeRequired":              426,
	"StatusPreconditionRequired":         428,
	"StatusTooManyRequests":              429,
	"StatusRequestHeaderFieldsTooLarge":  431,
	"StatusUnavailableForLegalReasons":   451,

	"StatusInternalServerError":           500,
	"StatusNotImplemented":                501,
	"StatusBadGateway":                    502,
	"StatusServiceUnavailable":            503,
	"StatusGatewayTimeout":                504,
	"StatusHTTPVersionNotSupported":       505,
	"StatusVariantAlsoNegotiates":         506,
	"StatusInsufficientStorage":           507,
	"StatusLoopDetected":                  508,
	"StatusNotExtended":                   510,
	"StatusNetworkAuthenticationRequired": 511,
}
