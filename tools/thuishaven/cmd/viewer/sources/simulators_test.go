package sources

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// @scenario "Simulator summaries come from the selected stack's listener"
func TestSimulatorSummaries(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/messages":
			fmt.Fprint(w, `{"messages":[{"id":"m1","subject":"Welcome","from":"sender@test","to":["ada@test"],"receivedAt":"2026-09-15T12:00:00Z"}]}`)
		case "/control/state":
			fmt.Fprint(w, `{"tenants":[{"id":3,"domain":"acme3.test","users":[{},{}],"applications":[{}],"scimToken":"private-scim","secret":"private-secret"}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	port := server.Listener.Addr().(*net.TCPAddr).Port
	mail, err := ReadSimulator(port, "mail")
	if err != nil {
		t.Fatal(err)
	}
	if len(mail) != 1 || mail[0].Path != "/messages/m1" || !strings.Contains(mail[0].Detail, "ada@test") {
		t.Fatal(mail)
	}
	idp, err := ReadSimulator(port, "idp")
	if err != nil {
		t.Fatal(err)
	}
	if len(idp) != 1 || idp[0].Path != "/t/3/" || !strings.Contains(idp[0].Detail, "2 users · 1 applications") {
		t.Fatal(idp)
	}
	encoded, err := json.Marshal(idp)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "private-") {
		t.Fatal("credentials exposed")
	}
}
