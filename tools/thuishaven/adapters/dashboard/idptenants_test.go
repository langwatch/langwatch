package dashboard

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

func TestFetchIdPTenantsReadsTheControlState(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/control/state" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"tenants":[{"id":1,"domain":"acme1.test","baseUrl":"https://idp.x.langwatch.localhost/t/1","users":[]}],"dnsAddr":"127.0.0.1:53"}`))
	}))
	defer srv.Close()
	_, portText, _ := net.SplitHostPort(srv.Listener.Addr().String())
	port, _ := strconv.Atoi(portText)
	got := FetchIdPTenants(context.Background(), port)
	if len(got) != 1 || got[0] != (IdPTenant{ID: "1", Domain: "acme1.test", URL: "https://idp.x.langwatch.localhost/t/1"}) {
		t.Errorf("tenants = %+v", got)
	}
}

func TestFetchIdPTenantsIsEmptyWhenNothingAnswers(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	_ = l.Close()
	if got := FetchIdPTenants(context.Background(), port); got != nil {
		t.Errorf("tenants = %+v, want none from a closed port", got)
	}
}
