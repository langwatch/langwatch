package backup

import (
	"context"
	"fmt"
	"time"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/chclient"
)

// Store is what the engine needs from ClickHouse.
type Store interface {
	FlushLogs(ctx context.Context) error
	InFlight(ctx context.Context) ([]Backup, error)
	Created(ctx context.Context, since time.Time) ([]Backup, error)
	Summary(ctx context.Context, mode Mode) (count int, last time.Time, err error)
	Exec(ctx context.Context, stmt string) error
	// Status reads id; found is false once no table knows it.
	Status(ctx context.Context, id string) (b Backup, found bool, err error)
	List(ctx context.Context, limit int) ([]Backup, error)
	Replicas(ctx context.Context) (Replicas, error)
}

// SQLStore is the Store over a ClickHouse client.
type SQLStore struct {
	Client   *chclient.Client
	Database string
	Tables   Tables
}

type row struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
	Error  string `json:"error"`
	Start  int64  `json:"start_ts"`
	End    int64  `json:"end_ts"`
	Bytes  uint64 `json:"size_bytes"`
	Host   string `json:"host"`
}

func (r row) backup() Backup {
	b := Backup{ID: r.ID, Status: r.Status, Error: r.Error, Bytes: r.Bytes, Host: r.Host}
	if r.Start > 0 {
		b.Start = time.Unix(r.Start, 0).UTC()
	}
	if r.End > 0 {
		b.End = time.Unix(r.End, 0).UTC()
	}
	return b
}

// ours keeps the rows naming one of db's backups.
func (s *SQLStore) ours(rows []row) []Backup {
	var out []Backup
	for _, r := range rows {
		path, mode, ok := Classify(s.Database, r.Name)
		if !ok {
			continue
		}
		b := r.backup()
		b.Path, b.Mode = path, mode
		out = append(out, b)
	}
	return out
}

func (s *SQLStore) FlushLogs(ctx context.Context) error {
	return s.Client.Exec(ctx, FlushLogsSQL)
}

func (s *SQLStore) InFlight(ctx context.Context) ([]Backup, error) {
	rows, err := chclient.Rows[row](ctx, s.Client, s.Tables.InFlightSQL())
	if err != nil {
		return nil, fmt.Errorf("checking for in-flight backups: %w", err)
	}
	return s.ours(rows), nil
}

// A server that has never logged a backup has no backup_log yet; locally
// that means no history. FlushLogs creates the table on every sidecar.
func (s *SQLStore) Created(ctx context.Context, since time.Time) ([]Backup, error) {
	rows, err := chclient.Rows[row](ctx, s.Client, s.Tables.CreatedSQL(s.Database, since))
	if err != nil && !(s.Tables.Cluster == "" && chclient.IsCode(err, chclient.CodeUnknownTable)) {
		return nil, fmt.Errorf("looking up completed backups: %w", err)
	}
	return s.ours(rows), nil
}

func (s *SQLStore) Summary(ctx context.Context, mode Mode) (int, time.Time, error) {
	rows, err := chclient.Rows[struct {
		Created int   `json:"created"`
		Last    int64 `json:"last_end_ts"`
	}](ctx, s.Client, s.Tables.SummarySQL(s.Database, mode))
	if err != nil {
		if s.Tables.Cluster == "" && chclient.IsCode(err, chclient.CodeUnknownTable) {
			return 0, time.Time{}, nil
		}
		return 0, time.Time{}, fmt.Errorf("looking up %s backup history: %w", mode, err)
	}
	// clusterAllReplicas yields one row per replica.
	var n int
	var last time.Time
	for _, r := range rows {
		n += r.Created
		if r.Last > 0 && time.Unix(r.Last, 0).After(last) {
			last = time.Unix(r.Last, 0).UTC()
		}
	}
	return n, last, nil
}

func (s *SQLStore) Exec(ctx context.Context, stmt string) error {
	return s.Client.Exec(ctx, stmt)
}

func (s *SQLStore) Status(ctx context.Context, id string) (Backup, bool, error) {
	for _, query := range []string{s.Tables.StatusSQL(id), s.Tables.LoggedStatusSQL(id)} {
		rows, err := chclient.Rows[row](ctx, s.Client, query)
		if err != nil {
			if chclient.IsCode(err, chclient.CodeUnknownTable) {
				continue
			}
			return Backup{}, false, err
		}
		if len(rows) > 0 {
			b := rows[0].backup()
			if path, mode, ok := Classify(s.Database, rows[0].Name); ok {
				b.Path, b.Mode = path, mode
			} else if path, ok := DiskPath(rows[0].Name); ok {
				b.Path = path
			}
			return b, true, nil
		}
	}
	return Backup{}, false, nil
}

func (s *SQLStore) List(ctx context.Context, limit int) ([]Backup, error) {
	rows, err := chclient.Rows[row](ctx, s.Client, s.Tables.ListSQL(limit))
	if err != nil {
		return nil, err
	}
	var out []Backup
	for _, r := range rows {
		b := r.backup()
		b.Path, _ = DiskPath(r.Name)
		_, b.Mode, _ = Classify(s.Database, r.Name)
		out = append(out, b)
	}
	return out, nil
}

func (s *SQLStore) Replicas(ctx context.Context) (Replicas, error) {
	if s.Tables.Cluster == "" {
		return Replicas{Total: 1, Self: 0, Reachable: []int{0}}, nil
	}
	cluster, err := chclient.Rows[struct {
		Self uint8  `json:"is_self"`
		Host string `json:"host"`
	}](ctx, s.Client, ReplicasSQL(s.Tables.Cluster))
	if err != nil {
		return Replicas{}, fmt.Errorf("reading cluster %s: %w", s.Tables.Cluster, err)
	}
	r := Replicas{Total: len(cluster), Self: -1}
	for i, c := range cluster {
		if c.Self == 1 && r.Self < 0 {
			r.Self = i
		}
	}
	if r.Total == 0 || r.Self < 0 {
		return Replicas{}, fmt.Errorf("cluster %s does not list this server", s.Tables.Cluster)
	}
	up, err := chclient.Rows[struct {
		Position int `json:"replica_position"`
	}](ctx, s.Client, ReachableSQL(s.Tables.Cluster))
	if err != nil {
		return r, fmt.Errorf("probing the replicas of %s: %w", s.Tables.Cluster, err)
	}
	for _, u := range up {
		r.Reachable = append(r.Reachable, u.Position-1)
	}
	return r, nil
}
