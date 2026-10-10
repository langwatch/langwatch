package colima

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// startRecord is haven's note that it started a profile's VM, and when it
// stopped it again. Only a VM with a record without StoppedAt is haven's to stop.
type startRecord struct {
	Profile   string    `json:"profile"`
	StartedAt time.Time `json:"startedAt"`
	StoppedAt time.Time `json:"stoppedAt,omitzero"`
}

func (r *Runtime) recordPath() string {
	return filepath.Join(r.home, "colima-"+r.profile+".json")
}

func (r *Runtime) readRecord() (startRecord, bool) {
	if r.home == "" {
		return startRecord{}, false
	}
	data, err := os.ReadFile(r.recordPath())
	if err != nil {
		return startRecord{}, false
	}
	var rec startRecord
	return rec, json.Unmarshal(data, &rec) == nil && rec.Profile == r.profile
}

func (r *Runtime) writeRecord(rec startRecord) {
	if r.home == "" {
		return
	}
	if data, err := json.Marshal(rec); err == nil {
		_ = os.WriteFile(r.recordPath(), data, 0o600)
	}
}

func (r *Runtime) recordStart() {
	r.writeRecord(startRecord{Profile: r.profile, StartedAt: time.Now()})
}

// StoppedByHaven reports whether haven stopped this VM because nothing needed it.
func (r *Runtime) StoppedByHaven() bool {
	rec, ok := r.readRecord()
	return ok && !rec.StoppedAt.IsZero()
}

// StopIfIdle stops the VM when haven started it and no container is running on
// it. A VM the user started (no record) is never touched. It reports whether it
// stopped the VM.
func (r *Runtime) StopIfIdle(ctx context.Context) (bool, error) {
	rec, ok := r.readRecord()
	if !ok || !rec.StoppedAt.IsZero() || !r.IsRunning(ctx) {
		return false, nil
	}
	host, err := r.DockerHost(ctx)
	if err != nil {
		return false, err
	}
	out, err := r.Docker(ctx, host, "ps", "-q").Output()
	if err != nil {
		return false, err // unknown: leave the VM alone
	}
	if strings.TrimSpace(string(out)) != "" {
		return false, nil
	}
	if err := r.run(ctx, "stop", "-p", r.profile); err != nil {
		return false, err
	}
	rec.StoppedAt = time.Now()
	r.writeRecord(rec)
	return true, nil
}
