package cmd

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

func TestSetForcedErrorSendsTheStatusAndRefusesTheRest(t *testing.T) {
	var body string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		body = string(raw)
		_, _ = w.Write(raw)
	}))
	t.Cleanup(srv.Close)
	api := sources.NewSimAPIAt(srv.URL)
	for _, status := range []string{"503", "0"} {
		inv := simInv("set")
		inv.flags = map[string]string{"--error": status}
		captureStdout(t, func() {
			if err := simSetForcedError(api, "storage", inv, false); err != nil {
				t.Fatal(err)
			}
		})
		if !strings.Contains(body, `"forcedError":`+status) {
			t.Fatalf("set --error %s sent %s", status, body)
		}
	}
	for _, flags := range []map[string]string{nil, {"--error": "x"}} {
		inv := simInv("set")
		inv.flags = flags
		if err := simSetForcedError(api, "mail", inv, false); err == nil {
			t.Fatalf("flags %v were accepted", flags)
		}
	}
}
