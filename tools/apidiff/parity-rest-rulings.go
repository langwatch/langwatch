package apidiff

const (
	rulingConnectRedesign = "deliberate: the connect protocol was redesigned on the branch (r39 triage)"
	rulingFlattening      = "artifact: the branch documents a union main flattened; the wire shape matches (r39 triage)"
	rulingPhantomField    = "phantom: main documents a field its handler never answers or accepts (r39 triage)"
)

// ruledBreakingRest names the operations whose breaking rows were triaged
// and ruled not defects; they still render, under their ruling.
var ruledBreakingRest = map[string]string{
	"POST /api/agents/connect/frames":          rulingConnectRedesign,
	"GET /api/agents/connect/poll":             rulingConnectRedesign,
	"POST /api/agents/connect/register":        rulingConnectRedesign,
	"POST /api/langy/control/connect/frames":   rulingConnectRedesign,
	"GET /api/langy/control/connect/poll":      rulingConnectRedesign,
	"POST /api/langy/control/connect/register": rulingConnectRedesign,
	"GET /api/checkup":                         rulingFlattening,
	"POST /api/checkup/run":                    rulingFlattening,
	"GET /api/traces/facets":                   rulingFlattening,
	"GET /api/projects":                        rulingPhantomField,
	"POST /api/projects":                       rulingPhantomField,
	"GET /api/projects/{id}":                   rulingPhantomField,
	"PATCH /api/projects/{id}":                 rulingPhantomField,
	"GET /api/query/reference":                 rulingPhantomField,
	"GET /api/query/schema":                    rulingPhantomField,
	"POST /api/trace/search":                   rulingPhantomField,
	"GET /api/trace/{id}":                      rulingPhantomField,
	"POST /api/trace/{id}/unshare":             rulingPhantomField,
	"POST /api/evaluations/batch/log_results":  rulingPhantomField,
}
