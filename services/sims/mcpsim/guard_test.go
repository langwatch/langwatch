package mcpsim

import (
	"net/http"
	"strings"
	"testing"
)

// @scenario "The sim answers only on this machine"
func TestTheSimAnswersOnlyOnThisMachine(t *testing.T) {
	t.Setenv("MCPSIM_ADDR", "")
	if addr := LoadConfig().Addr; !strings.HasPrefix(addr, "127.0.0.1:") {
		t.Errorf("the default address %q is not loopback", addr)
	}

	f := newFakeLangWatch(t)
	_, sim := simAt(t, f)
	for _, host := range []string{"attacker.example", "attacker.example:5598", "192.168.1.20"} {
		req, _ := http.NewRequest(http.MethodPost, sim+"/_sim/api/runs", strings.NewReader(`{"scenario":"connect"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Host = host
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("a request naming %s answered %d", host, resp.StatusCode)
		}
	}
	if _, list := call[map[string][]RunStatus](t, http.MethodGet, sim+"/_sim/api/runs", nil); len(list["runs"]) != 0 {
		t.Errorf("a refused host started %d runs", len(list["runs"]))
	}

	for _, host := range []string{"localhost:5598", "127.0.0.1", "[::1]:5598", "mcp.feat-x.langwatch.localhost"} {
		req, _ := http.NewRequest(http.MethodGet, sim+"/healthz", nil)
		req.Host = host
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("a request naming %s answered %d", host, resp.StatusCode)
		}
	}
}
