package access

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/bootstrap"
)

const (
	// UsersFileName and AuthFileName are what the image renders into users.d and config.d.
	UsersFileName = "access-users.yaml"
	AuthFileName  = "access-auth.yaml"
	// SyncInterval bounds how long a removed or expired password stays valid.
	SyncInterval = 10 * time.Second
)

// Render plans the access users at now and writes them under usersD,
// returning the plan. Used by `ch-config generate` and by every sync.
func Render(f *File, in Inputs, now time.Time, usersD string) (Planned, bool, error) {
	p := Plan(f, in, now)
	data, err := p.UsersYAML()
	if err != nil {
		return p, false, err
	}
	changed, err := WriteIfChanged(filepath.Join(usersD, UsersFileName), data)
	return p, changed, err
}

// Syncer keeps users.d/access-users.yaml current with the access file and the
// password directories. An input that cannot be read keeps the last good file.
type Syncer struct {
	AccessFile string
	UsersD     string
	Log        *zap.Logger
	Now        func() time.Time
	// OnLoad receives each newly loaded, valid access file (token verification).
	OnLoad func(*File)

	lastRaw      []byte
	lastWarnings string
}

// Sync runs one pass and returns how long to wait before the next.
func (s *Syncer) Sync() time.Duration {
	now := s.Now()
	f, err := Load(s.AccessFile)
	if err != nil {
		s.Log.Error("access file not applied, keeping the last rendered users", zap.Error(err))
		return SyncInterval
	}
	// The server fixed its mode at start (default's lock, the local admin).
	// A file switching it live would leave the two out of step: in standard
	// mode the sidecar would render passwords onto a dynamic-only server.
	if server := s.serverDynamicOnly(); f.DynamicOnly() != server {
		s.Log.Error("access file not applied: its mode differs from the one the server started in; "+
			"restart the server to change mode, keeping the last rendered users",
			zap.Bool("file_dynamic_only", f.DynamicOnly()), zap.Bool("server_dynamic_only", server))
		return SyncInterval
	}
	if !bytes.Equal(f.Raw, s.lastRaw) {
		s.lastRaw = f.Raw
		if s.OnLoad != nil {
			s.OnLoad(f)
		}
	}
	in, err := Gather(f)
	if err != nil {
		s.Log.Error("password files not applied, keeping the last rendered users", zap.Error(err))
		return SyncInterval
	}
	p, changed, err := Render(f, in, now, s.UsersD)
	if err != nil {
		s.Log.Error("writing the access users failed", zap.Error(err))
		return SyncInterval
	}
	if warnings := strings.Join(p.Warnings, "\n"); changed || warnings != s.lastWarnings {
		s.lastWarnings = warnings
		for _, w := range p.Warnings {
			s.Log.Warn(w)
		}
	}
	if changed {
		s.Log.Info("access users updated", zap.Strings("users", p.UserNames()))
	}
	return nextDelay(p, now)
}

// serverDynamicOnly reports whether the server started in dynamic-only mode:
// `ch-config generate` renders the local admin into users.d then, and only then.
func (s *Syncer) serverDynamicOnly() bool {
	_, err := os.Stat(filepath.Join(s.UsersD, bootstrap.UsersFileName))
	return err == nil
}

func nextDelay(p Planned, now time.Time) time.Duration {
	if p.NextChange == nil {
		return SyncInterval
	}
	return min(SyncInterval, max(p.NextChange.Sub(now), 100*time.Millisecond))
}

// Run syncs until ctx ends.
func (s *Syncer) Run(ctx context.Context) {
	for {
		timer := time.NewTimer(s.Sync())
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
