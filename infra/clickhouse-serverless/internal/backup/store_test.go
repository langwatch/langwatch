package backup

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/chclient"
)

// upgradedServer is a ClickHouse whose upgrade renamed the old backup_log to
// backup_log_0 and started an empty backup_log: the last full lives only in
// backup_log_0. A query sees that full only if it reads every copy.
func upgradedServer(t *testing.T, fullName string, fullEnd time.Time) *SQLStore {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		q := string(body)
		readsCopies := strings.Contains(q, "merge('system', '^backup_log')")
		switch {
		case strings.Contains(q, "system.backups"):
			// The in-memory table: a restart emptied it.
		case strings.HasPrefix(q, "SELECT count()"):
			if readsCopies {
				_, _ = io.WriteString(w, `{"created":1,"last_end_ts":`+strconv.FormatInt(fullEnd.Unix(), 10)+"}\n")
			} else {
				_, _ = io.WriteString(w, `{"created":0,"last_end_ts":0}`+"\n")
			}
		case readsCopies:
			_, _ = io.WriteString(w, `{"id":"full-1","name":"`+fullName+`","status":"BACKUP_CREATED","error":"","start_ts":`+
				strconv.FormatInt(fullEnd.Add(-time.Minute).Unix(), 10)+`,"end_ts":`+strconv.FormatInt(fullEnd.Unix(), 10)+`,"size_bytes":4096,"host":"ch-0"}`+"\n")
		}
	}))
	t.Cleanup(srv.Close)
	return &SQLStore{
		Client:   &chclient.Client{BaseURL: srv.URL, Creds: chclient.Static{User: "u", Password: "p"}},
		Database: "langwatch",
	}
}

// @scenario "The base is found in the backup_log copies an upgrade renamed"
func TestLookupsFindTheFullInARenamedBackupLog(t *testing.T) {
	fullEnd := time.Date(2026, 11, 9, 5, 2, 0, 0, time.UTC)
	path := NewPath("langwatch", Full, fullEnd.Add(-2*time.Minute))
	name := "Disk('backups', '" + path + "')"
	ctx := context.Background()

	for _, cluster := range []string{"", "langwatch"} {
		s := upgradedServer(t, name, fullEnd)
		s.Tables = Tables{Cluster: cluster}

		created, err := s.Created(ctx, fullEnd.Add(-24*time.Hour))
		if err != nil {
			t.Fatalf("cluster %q: Created: %v", cluster, err)
		}
		if len(created) != 1 || created[0].Path != path || created[0].Mode != Full {
			t.Errorf("cluster %q: the base lookup missed the full in backup_log_0: %+v", cluster, created)
		}

		n, last, err := s.Summary(ctx, Full)
		if err != nil {
			t.Fatalf("cluster %q: Summary: %v", cluster, err)
		}
		if n != 1 || !last.Equal(fullEnd) {
			t.Errorf("cluster %q: fulls ever = %d, last = %v; want 1 at %v", cluster, n, last, fullEnd)
		}

		listed, err := s.List(ctx, 10)
		if err != nil {
			t.Fatalf("cluster %q: List: %v", cluster, err)
		}
		if len(listed) != 1 || listed[0].Path != path {
			t.Errorf("cluster %q: list missed the full in backup_log_0: %+v", cluster, listed)
		}

		b, found, err := s.Status(ctx, "full-1")
		if err != nil || !found || b.Status != "BACKUP_CREATED" {
			t.Errorf("cluster %q: status of a backup logged before the upgrade = %+v, %v, %v", cluster, b, found, err)
		}
	}
}

// @scenario "The base is found in the backup_log copies an upgrade renamed"
func TestFreshServerWithNoBackupLogHasNoHistory(t *testing.T) {
	// merge() over no matching table fails with CANNOT_EXTRACT_TABLE_STRUCTURE,
	// not UNKNOWN_TABLE: locally that is still a server with no history.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(string(body), "system.backups") {
			return
		}
		w.Header().Set("X-ClickHouse-Exception-Code", "636")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, "Code: 636. DB::Exception: There are no tables satisfied provided regexp, you must specify table structure manually. (CANNOT_EXTRACT_TABLE_STRUCTURE)")
	}))
	defer srv.Close()
	s := &SQLStore{Client: &chclient.Client{BaseURL: srv.URL, Creds: chclient.Static{User: "u", Password: "p"}}, Database: "langwatch"}
	ctx := context.Background()

	if created, err := s.Created(ctx, time.Unix(0, 0)); err != nil || len(created) != 0 {
		t.Errorf("Created = %v, %v; want no history", created, err)
	}
	if n, _, err := s.Summary(ctx, Full); err != nil || n != 0 {
		t.Errorf("Summary = %d, %v; want no history", n, err)
	}
	if _, found, err := s.Status(ctx, "gone"); err != nil || found {
		t.Errorf("Status = %v, %v; want not found", found, err)
	}

	// On a cluster the sidecar flushed every server's logs first, so a missing
	// table is a real fault, not an empty history.
	s.Tables = Tables{Cluster: "langwatch"}
	if _, err := s.Created(ctx, time.Unix(0, 0)); err == nil {
		t.Error("a cluster read that found no backup_log passed as no history")
	}
}

// @scenario "Exactly one replica runs backups, failing over to the next that answers"
func TestReplicasCountsEachReplicaOnceWhenSystemClustersRepeatsIt(t *testing.T) {
	// ClickHouse 26.8 on a three-replica cluster listed every replica twice.
	// Counted by row, clickhouse-2 sat at position 4 of 6, where
	// clusterAllReplicas never reports one, so no replica ran backups.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		q := string(body)
		switch {
		case strings.Contains(q, "FROM system.clusters"):
			for _, row := range []string{
				`{"shard_num":1,"replica_num":1,"is_self":0,"host":"ch-0"}`,
				`{"shard_num":1,"replica_num":1,"is_self":0,"host":"ch-0"}`,
				`{"shard_num":1,"replica_num":2,"is_self":0,"host":"ch-1"}`,
				`{"shard_num":1,"replica_num":2,"is_self":0,"host":"ch-1"}`,
				`{"shard_num":1,"replica_num":3,"is_self":1,"host":"ch-2"}`,
				`{"shard_num":1,"replica_num":3,"is_self":1,"host":"ch-2"}`,
			} {
				_, _ = io.WriteString(w, row+"\n")
			}
		case strings.Contains(q, "clusterAllReplicas"):
			_, _ = io.WriteString(w, "{\"replica_position\":3}\n{\"replica_position\":1}\n{\"replica_position\":2}\n")
		}
	}))
	defer srv.Close()
	s := &SQLStore{
		Client:   &chclient.Client{BaseURL: srv.URL, Creds: chclient.Static{User: "u", Password: "p"}},
		Database: "langwatch",
		Tables:   Tables{Cluster: "langwatch"},
	}

	r, err := s.Replicas(context.Background())
	if err != nil {
		t.Fatalf("Replicas: %v", err)
	}
	if r.Total != 3 || r.Self != 2 {
		t.Errorf("Replicas = total %d, self %d; want total 3, self 2", r.Total, r.Self)
	}
	if !IsRunner(r, 2, nil) {
		t.Errorf("clickhouse-2 with BACKUP_RUNNER_ORDINAL=2 is not the runner: %+v", r)
	}
}
