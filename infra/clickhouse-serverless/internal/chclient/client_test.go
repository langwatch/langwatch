package chclient

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRowsSendsCredentialsInHeadersAndDecodes(t *testing.T) {
	var gotQuery, gotUser, gotKey, gotURL string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotQuery, gotUser, gotKey, gotURL = string(b), r.Header.Get("X-ClickHouse-User"), r.Header.Get("X-ClickHouse-Key"), r.URL.String()
		_, _ = io.WriteString(w, "{\"n\":1,\"s\":\"a\"}\n{\"n\":2,\"s\":\"b\"}\n")
	}))
	defer srv.Close()

	dir := t.TempDir()
	pw := filepath.Join(dir, "password")
	if err := os.WriteFile(pw, []byte(" secret-value \n"), 0o600); err != nil {
		t.Fatal(err)
	}
	c := &Client{BaseURL: srv.URL, Creds: PasswordFile{User: "backup", Path: pw}}
	rows, err := Rows[struct {
		N int    `json:"n"`
		S string `json:"s"`
	}](context.Background(), c, "SELECT 1")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[1].N != 2 || rows[1].S != "b" {
		t.Errorf("rows = %+v", rows)
	}
	if gotQuery != "SELECT 1 FORMAT JSONEachRow" {
		t.Errorf("query = %q", gotQuery)
	}
	if gotUser != "backup" || gotKey != "secret-value" {
		t.Errorf("login = %q/%q", gotUser, gotKey)
	}
	if strings.Contains(gotURL, "secret") || strings.Contains(gotURL, "backup") {
		t.Errorf("credentials leaked into the URL: %s", gotURL)
	}
}

func TestErrorsCarryTheClickHouseCode(t *testing.T) {
	for _, tc := range []struct {
		name   string
		header string
		body   string
		want   int
	}{
		{"header", "60", "Code: 60. DB::Exception: Table system.backup_log does not exist", 60},
		{"body only", "", "Code: 516. DB::Exception: default: Authentication failed", 516},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tc.header != "" {
					w.Header().Set("X-ClickHouse-Exception-Code", tc.header)
				}
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer srv.Close()
			c := &Client{BaseURL: srv.URL, Creds: Static{User: "u", Password: "p"}}
			err := c.Exec(context.Background(), "SELECT 1")
			if !IsCode(err, tc.want) {
				t.Errorf("err = %v, want code %d", err, tc.want)
			}
		})
	}
}

func TestPasswordFileRefusesEmpty(t *testing.T) {
	pw := filepath.Join(t.TempDir(), "password")
	if err := os.WriteFile(pw, []byte("\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := (PasswordFile{User: "u", Path: pw}).Login(); err == nil {
		t.Error("an empty password file was accepted")
	}
	if _, _, err := (PasswordFile{User: "u", Path: pw + ".missing"}).Login(); err == nil {
		t.Error("a missing password file was accepted")
	}
}
