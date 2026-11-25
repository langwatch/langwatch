// Package egress is the outbound fence an HTTP scenario target is dialed
// through: the Go twin of packages/egress's createSsrfUrlValidator and
// fetchValidatedDestination. Addresses are classified by pkg/ssrf, the rule
// set the TypeScript fence is held byte-equal to; the decision is made once
// and the judged address is the one dialed, so DNS cannot rebind it.
package egress

import (
	"encoding/json"
	"fmt"
)

// PolicyEnv is the variable the parent states the fence in.
const PolicyEnv = "LANGWATCH_SCENARIO_EGRESS_POLICY"

// Policy is which addresses a run may reach.
type Policy struct {
	// BlockLocal refuses private, loopback and link-local destinations.
	BlockLocal bool
	// AllowedHosts are literal hostnames exempt from BlockLocal. Cloud
	// metadata is never exempt.
	AllowedHosts []string
}

// DecodePolicy reads the parent's policy document. It never defaults: a
// missing or malformed document is an error naming the variable, because
// every guess available here opens the fence rather than closing it.
func DecodePolicy(raw string) (Policy, error) {
	if raw == "" {
		return Policy{}, refusalf("%s is not set: the parent process must state the egress policy a scenario child dials an HTTP target with.", PolicyEnv)
	}
	var doc struct {
		BlockLocal   *bool     `json:"blockLocal"`
		AllowedHosts *[]string `json:"allowedHosts"`
	}
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return Policy{}, fmt.Errorf("%s is not a valid policy document: %w", PolicyEnv, err)
	}
	if doc.BlockLocal == nil || doc.AllowedHosts == nil {
		return Policy{}, refusal(PolicyEnv + " must carry both blockLocal and allowedHosts")
	}
	return Policy{BlockLocal: *doc.BlockLocal, AllowedHosts: *doc.AllowedHosts}, nil
}

// refusal is an error worded as packages/egress words it. The text crosses
// the wire to the parent, so it keeps the Node child's capitals and stops.
type refusal string

func (r refusal) Error() string { return string(r) }

func refusalf(format string, args ...any) error { return refusal(fmt.Sprintf(format, args...)) }
