package clickhousehttp

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// recordingServer answers every statement OK, the memory probe with
// serverMemory, and fails any statement containing failOn.
type recordingServer struct {
	mu           sync.Mutex
	statements   []string
	serverMemory string
	failOn       string
}

func (r *recordingServer) start(t *testing.T) Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, _ := io.ReadAll(req.Body)
		sql := string(body)
		r.mu.Lock()
		r.statements = append(r.statements, sql)
		r.mu.Unlock()
		if r.failOn != "" && strings.Contains(sql, r.failOn) {
			http.Error(w, "Code: 497. ACCESS_DENIED", http.StatusInternalServerError)
			return
		}
		if strings.Contains(sql, "max_server_memory_usage") {
			_, _ = io.WriteString(w, r.serverMemory+"\n")
		}
	}))
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	port, _ := strconv.Atoi(u.Port())
	return Client{Port: func() int { return port }, CPUs: 4}
}

func TestEnsureStackAccess(t *testing.T) {
	t.Run("given a server with a memory ceiling", func(t *testing.T) {
		rec := &recordingServer{serverMemory: "2000"}
		c := rec.start(t)

		t.Run("when provisioning, the hierarchy lands before the stack and the cap is half", func(t *testing.T) {
			if err := c.EnsureStackAccess(context.Background(), "lw_feat_x", "pw"); err != nil {
				t.Fatalf("EnsureStackAccess: %v", err)
			}
			joined := strings.Join(rec.statements, "\n")
			resource := strings.Index(joined, "CREATE RESOURCE")
			stack := strings.Index(joined, "`stack_feat_x`")
			if resource < 0 || stack < 0 || resource > stack {
				t.Errorf("want the resource before the stack workload:\n%s", joined)
			}
			if !strings.Contains(joined, "max_concurrent_threads = 4") {
				t.Errorf("want the root capped at the configured cores:\n%s", joined)
			}
			if !strings.Contains(joined, "max_memory_usage_for_user = 1000") {
				t.Errorf("want half the server's memory:\n%s", joined)
			}
		})
	})

	t.Run("given a grant the server refuses", func(t *testing.T) {
		rec := &recordingServer{serverMemory: "2000", failOn: "GRANT POSTGRES"}
		c := rec.start(t)

		t.Run("when provisioning, the refusal is returned", func(t *testing.T) {
			if err := c.EnsureStackAccess(context.Background(), "lw_feat_x", "pw"); err == nil {
				t.Fatal("want the refusal, so the stack keeps the shared login")
			}
		})
	})
}

func TestDropDatabaseTakesTheStackAccessWithIt(t *testing.T) {
	t.Run("given a stack database", func(t *testing.T) {
		rec := &recordingServer{}
		c := rec.start(t)

		t.Run("when dropping, the database goes first, then its login and workload", func(t *testing.T) {
			if err := c.DropDatabase(context.Background(), "lw_feat_x"); err != nil {
				t.Fatalf("DropDatabase: %v", err)
			}
			want := []string{
				"DROP DATABASE IF EXISTS `lw_feat_x`",
				"DROP USER IF EXISTS `lw_feat_x_app`",
				"DROP WORKLOAD IF EXISTS `stack_feat_x`",
			}
			if strings.Join(rec.statements, "|") != strings.Join(want, "|") {
				t.Errorf("statements = %v, want %v", rec.statements, want)
			}
		})
	})

	t.Run("given the database drop fails", func(t *testing.T) {
		rec := &recordingServer{failOn: "DROP DATABASE"}
		c := rec.start(t)

		t.Run("when dropping, the login is left for the next attempt", func(t *testing.T) {
			if err := c.DropDatabase(context.Background(), "lw_feat_x"); err == nil {
				t.Fatal("want the failure")
			}
			if len(rec.statements) != 1 {
				t.Errorf("statements = %v, want only the database drop", rec.statements)
			}
		})
	})
}

func TestSetStackWeight(t *testing.T) {
	rec := &recordingServer{}
	c := rec.start(t)
	if err := c.SetStackWeight(context.Background(), "lw_feat_x", 3); err != nil {
		t.Fatalf("SetStackWeight: %v", err)
	}
	if len(rec.statements) != 1 || !strings.Contains(rec.statements[0], "`stack_feat_x` IN `stacks` SETTINGS weight = 3") {
		t.Errorf("statements = %v", rec.statements)
	}
}
