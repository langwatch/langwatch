// Package workerpool is the driven adapter that owns worker lifecycle for the
// langyagent manager. It holds what survives of the ADR-033 isolation model:
// the per-worker UID, the 0700 chown-before-secrets home, the sensitive-env
// denylist, the Setpgid process-group kill and the orphan reaper, wrapped in
// herr + OpenTelemetry.
//
// Three mechanisms ADR-033 put here are GONE, and looking for them is a waste
// of an afternoon: the per-worker OPENCODE_SERVER_PASSWORD, the authProxy
// bearer-to-Basic swap and the fail-closed control-server auth guard. All three
// defended a loopback HTTP control port that the removed harness opened.
// Workers are now driven over the anonymous stdio pipes they are spawned with
// (ADR-131), so there is no port to defend and nothing replaced them.
//
// The per-worker UID itself is no longer unconditional either: ADR-130 made it
// an operator's choice, and under "none" the pool skips reservation entirely
// because the runner cannot apply it.
package workerpool

import (
	"crypto/sha256"
	"encoding/binary"
)

// Per-worker UID range. Each conversation gets its own UID so that worker A can
// never open(2) worker B's per-session config (LANGWATCH API key, GH token,
// repo clone). The kernel enforces it via mode 0700 + chown to the
// per-conversation UID. UIDs are derived deterministically from the
// conversation id so the same conversation always lands on the same UID, and
// 2000 + (hash % 60000) keeps us above system reserved UIDs and below the
// uid_t signed boundary on 32-bit platforms.
//
// Requires the container to run as root with CAP_SETUID + CAP_SETGID +
// CAP_CHOWN + CAP_DAC_OVERRIDE so the manager can chown per-session directories
// and exec into them as the unprivileged UID. The chart sets exactly that
// capability set; everything else stays dropped.
const (
	workerUIDBase  = 2000
	workerUIDRange = 60000
)

// workerUIDFor returns a deterministic UID for a conversation. Collisions
// across the 60k range are astronomically rare for the practical worker count
// (MAX_WORKERS=20 by default). Concurrent collision safety is NOT provided by
// reaping — it's provided by reserveUIDLocked's linear probe (see pool.go)
// which picks the next free slot when the deterministic UID is in use by a live
// worker. The reaping comment above is what makes the SAME UID safe to reuse
// AFTER a worker exits.
func workerUIDFor(conversationID string) uint32 {
	sum := sha256.Sum256([]byte(conversationID))
	slot := binary.BigEndian.Uint32(sum[:4]) % workerUIDRange
	return workerUIDBase + slot
}
