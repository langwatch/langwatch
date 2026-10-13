package cell

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"sync/atomic"
	"time"
)

// unreachableBody marks the balancer's own answer when no release listens: the traffic counts it
// as an unanswered call, never as a status the api chose.
const unreachableBody = "upgradelab-balancer: no release answered"

// Balancer is the cell's load balancer: one public address in front of whichever release serves,
// switched as a rolling deploy switches, so every client keeps one URL through the upgrade.
type Balancer struct {
	target atomic.Pointer[url.URL]
	server *http.Server
}

// StartBalancer listens on port and forwards to nothing until Switch names a release.
func StartBalancer(port int) (*Balancer, error) {
	balancer := &Balancer{}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(request *httputil.ProxyRequest) {
			if target := balancer.target.Load(); target != nil {
				request.SetURL(target)
				request.Out.Host = request.In.Host
			}
		},
		ErrorHandler: func(writer http.ResponseWriter, _ *http.Request, _ error) {
			writer.WriteHeader(http.StatusBadGateway)
			_, _ = writer.Write([]byte(unreachableBody))
		},
	}
	listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return nil, err
	}
	balancer.server = &http.Server{Handler: proxy, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := balancer.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			_ = listener.Close()
		}
	}()
	return balancer, nil
}

// Switch sends every new request to raw.
func (balancer *Balancer) Switch(raw string) error {
	target, err := url.Parse(raw)
	if err == nil {
		balancer.target.Store(target)
	}
	return err
}

// Close stops listening.
func (balancer *Balancer) Close() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = balancer.server.Shutdown(ctx)
}

// ServedTimeline is the phase each call met: the old release's until the switch, then head's.
func ServedTimeline(head []PhaseChange, switchedAt int64) []PhaseChange {
	served := []PhaseChange{{Phase: "from", AtMs: 0}}
	if switchedAt <= 0 {
		return served
	}
	served = append(served, PhaseChange{Phase: PhaseAt(head, switchedAt), AtMs: switchedAt})
	for _, change := range head {
		if change.AtMs > switchedAt {
			served = append(served, change)
		}
	}
	return served
}
