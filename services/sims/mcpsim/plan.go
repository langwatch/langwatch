package mcpsim

import (
	"cmp"
	"errors"
	"fmt"
	"strings"
	"time"
)

// plan is a checked RunRequest.
type plan struct {
	RunRequest
	persona    persona
	transports []string
	hold, idle time.Duration
	duration   time.Duration
	tool       string // the tool connect calls: Tool, or fetch_langwatch_docs
}

const defaultTool = "fetch_langwatch_docs"

func (s *Server) plan(req RunRequest) (*plan, error) {
	p := &plan{RunRequest: req}
	p.Endpoint = strings.TrimRight(cmp.Or(req.Endpoint, s.cfg.Endpoint), "/")
	p.Flow = cmp.Or(req.Flow, FlowAPIKey)
	if err := s.planFlow(p, req.Endpoint != ""); err != nil {
		return p, err
	}
	if err := checkEndpoint(p.Endpoint); err != nil {
		return p, err
	}
	var ok bool
	if p.persona, ok = personas[cmp.Or(req.Client, "claude-code")]; !ok {
		return p, fmt.Errorf("client %q is not claude-code, claude-desktop or cursor", req.Client)
	}
	transports, err := transportsOf(req)
	if err != nil {
		return p, err
	}
	p.transports = transports
	p.tool = cmp.Or(req.Tool, defaultTool)
	err = p.checkScenario()
	return p, err
}

// planFlow fills the credentials the flow presents.
func (s *Server) planFlow(p *plan, endpointGiven bool) error {
	switch p.Flow {
	case FlowAPIKey:
		// The configured key only ever goes to the configured endpoint.
		if p.Endpoint == s.cfg.Endpoint {
			p.APIKey = cmp.Or(p.APIKey, s.cfg.APIKey)
		}
		if p.APIKey == "" {
			return errors.New("the apikey flow needs a project API key: pass apiKey or set MCPSIM_API_KEY")
		}
	case FlowOAuth:
		g := s.grants.current()
		if g == nil {
			return errors.New("the oauth flow needs a grant: run the OAuth connect first (POST /_sim/api/oauth/connect, haven sim mcp oauth)")
		}
		// The grant's token only ever goes to the endpoint that issued it.
		if endpointGiven && p.Endpoint != g.endpoint {
			return fmt.Errorf("the OAuth grant was issued by %s and only goes there: connect OAuth to %s first", g.endpoint, p.Endpoint)
		}
		p.Endpoint = g.endpoint
	default:
		return fmt.Errorf("flow %q is neither apikey nor oauth", p.Flow)
	}
	return nil
}

// transportsOf is the paths a run uses; connect defaults to both.
func transportsOf(req RunRequest) ([]string, error) {
	switch req.Transport {
	case "":
		if req.Scenario == ScenarioConnect {
			return []string{"/mcp", "/sse"}, nil
		}
		return []string{"/mcp"}, nil
	case "/mcp", "mcp":
		return []string{"/mcp"}, nil
	case "/sse", "sse":
		return []string{"/sse"}, nil
	case "both":
		return []string{"/mcp", "/sse"}, nil
	}
	return nil, fmt.Errorf("transport %q is not /mcp, /sse or both", req.Transport)
}

// secondsOr is n seconds (fallback when unset), refused outside 1..maxHold.
func secondsOr(n, fallback int, what string) (time.Duration, error) {
	if n == 0 {
		n = fallback
	}
	if n < 0 || time.Duration(n)*time.Second > maxHold {
		return 0, fmt.Errorf("%s takes 1 to %d seconds", what, int(maxHold.Seconds()))
	}
	return time.Duration(n) * time.Second, nil
}

func (p *plan) checkScenario() error {
	var err error
	switch p.Scenario {
	case ScenarioConnect, ScenarioReconnect:
	case ScenarioStream:
		p.hold, err = secondsOr(p.HoldSeconds, 60, "holdSeconds")
	case ScenarioIdle:
		p.idle, err = secondsOr(p.IdleSeconds, 30, "idleSeconds")
	case ScenarioRefresh, ScenarioDoubleRefresh:
		if p.Flow != FlowOAuth {
			err = fmt.Errorf("%s needs the oauth flow", p.Scenario)
		}
	case ScenarioSoak:
		err = p.checkSoak()
	case ScenarioOAuthConnect:
		err = errors.New("oauth-connect starts at POST /_sim/api/oauth/connect")
	default:
		names := make([]string, 0, len(scenarios))
		for _, sc := range scenarios {
			names = append(names, sc.Name)
		}
		err = fmt.Errorf("unknown scenario %q; scenarios: %s", p.Scenario, strings.Join(names, ", "))
	}
	return err
}

func (p *plan) checkSoak() error {
	p.Clients = cmp.Or(p.Clients, 10)
	if p.Clients < 1 || p.Clients > maxClients {
		return fmt.Errorf("soak takes 1 to %d clients", maxClients)
	}
	d, err := time.ParseDuration(cmp.Or(p.Duration, "1m"))
	if err != nil || d <= 0 || d > maxDuration {
		return fmt.Errorf("soak takes a duration up to %s, e.g. 5m", maxDuration)
	}
	p.duration = d
	return nil
}
