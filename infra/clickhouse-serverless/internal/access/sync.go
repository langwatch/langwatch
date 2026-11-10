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
// password directories. An access file that cannot be applied keeps the last
// good one in force. Each password directory loads on its own: one that cannot
// be read keeps its user's last good passwords from this process, re-planned
// each pass so valid_until still applies, or else renders that user with none.
type Syncer struct {
	AccessFile string
	UsersD     string
	Log        *zap.Logger
	Now        func() time.Time
	// OnLoad receives each newly loaded, valid access file once its users are written.
	OnLoad func(*File)

	lastRaw      []byte
	lastFile     *File
	lastWarnings string
	// lastIn holds each user's last passwords read, lastDirs where they came from.
	lastIn   map[string][]Password
	lastDirs map[string]string
}

// Sync runs one pass and returns how long to wait before the next.
func (s *Syncer) Sync() time.Duration {
	now := s.Now()
	f, fresh := s.current()
	if f == nil {
		return SyncInterval
	}
	in := s.gather(f)
	p, changed, err := Render(f, in, now, s.UsersD)
	if err != nil {
		s.Log.Error("writing the access users failed", zap.Error(err))
		return SyncInterval
	}
	// Only after the write: the verifier never accepts a binding whose rights are not on disk.
	if fresh && !bytes.Equal(f.Raw, s.lastRaw) {
		s.lastRaw = f.Raw
		if s.OnLoad != nil {
			s.OnLoad(f)
		}
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

// current loads the access file. One that cannot be applied leaves the last
// good file in force, re-planned each pass so valid_until and removed password
// files still take effect; with none yet the rendered users stay as they are.
func (s *Syncer) current() (*File, bool) {
	f, err := Load(s.AccessFile)
	if err != nil {
		s.Log.Error("access file not applied, keeping the last good one", zap.Error(err))
		return s.lastFile, false
	}
	// The server fixed its mode at start (default's lock, the local admin);
	// a file switching it live would leave the two out of step.
	if server := s.serverDynamicOnly(); f.DynamicOnly() != server {
		s.Log.Error("access file not applied: its mode differs from the one the server started in; "+
			"restart the server to change mode, keeping the last good one",
			zap.Bool("file_dynamic_only", f.DynamicOnly()), zap.Bool("server_dynamic_only", server))
		return s.lastFile, false
	}
	s.lastFile = f
	return f, true
}

// gather reads each rolling user's directory. A user whose directory fails
// keeps the passwords this process last read from that same directory; with
// none it gets no file passwords, so it cannot log in (fail closed). The other
// users render normally either way. After a restart nothing is kept: a
// password rendered by the previous process never outlives its valid_until.
func (s *Syncer) gather(f *File) Inputs {
	in, errs := GatherEach(f)
	dirs := rollingDirs(f)
	if s.lastIn == nil {
		s.lastIn, s.lastDirs = map[string][]Password{}, map[string]string{}
	}
	for name := range s.lastIn {
		if _, ok := dirs[name]; !ok {
			delete(s.lastIn, name)
			delete(s.lastDirs, name)
		}
	}
	for name, passwords := range in.Passwords {
		s.lastIn[name], s.lastDirs[name] = passwords, dirs[name]
	}
	for _, u := range f.Users {
		err, failed := errs[u.Name]
		if !failed {
			continue
		}
		fields := []zap.Field{zap.String("user", u.Name), zap.String("dir", dirs[u.Name]), zap.Error(err)}
		if last, ok := s.lastIn[u.Name]; ok && s.lastDirs[u.Name] == dirs[u.Name] {
			s.Log.Error("password directory not applied, keeping the user's last good passwords", fields...)
			in.Passwords[u.Name] = last
			continue
		}
		s.Log.Error("password directory not applied and no last good passwords; "+
			"rendering the user with no file passwords", fields...)
	}
	return in
}

func rollingDirs(f *File) map[string]string {
	dirs := map[string]string{}
	for _, u := range f.Users {
		if u.Login.Rolling != nil {
			dirs[u.Name] = u.Login.Rolling.Dir
		}
	}
	return dirs
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
