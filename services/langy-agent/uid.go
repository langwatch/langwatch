package langyagent

import (
	"crypto/sha256"
	"encoding/binary"
	"regexp"
)

// Per-worker UID range. Each conversation gets its own UID so that worker A
// can never open(2) worker B's per-session config (LANGWATCH API key, GH
// token, repo clone). The kernel enforces it via mode 0700 + chown to the
// per-conversation UID. UIDs are derived deterministically from the
// conversation id so the same conversation always lands on the same UID,
// and 2000 + (hash % 60000) keeps us above system reserved UIDs and below
// the uid_t signed boundary on 32-bit platforms.
//
// Requires the container to run as root with CAP_SETUID + CAP_SETGID +
// CAP_CHOWN + CAP_DAC_OVERRIDE so the manager can chown per-session
// directories and exec into them as the unprivileged UID. The chart sets
// exactly that capability set; everything else stays dropped.
const (
	workerUIDBase  = 2000
	workerUIDRange = 60000
)

// workerUIDFor returns a deterministic UID for a conversation. Collisions
// across the 60k range are astronomically rare for the practical worker
// count (MAX_WORKERS=20 by default), and a collision is benign — the same
// UID is only reused after the prior worker for that UID has been reaped.
func workerUIDFor(conversationID string) uint32 {
	sum := sha256.Sum256([]byte(conversationID))
	slot := binary.BigEndian.Uint32(sum[:4]) % workerUIDRange
	return workerUIDBase + slot
}

// conversationIDPattern restricts conversationId to a filesystem-safe charset
// before it ever reaches filepath.Join — otherwise values like "../../etc"
// escape SESSIONS_ROOT.
var conversationIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// isValidConversationID is true when value is safe to use as a path segment.
func isValidConversationID(value string) bool {
	return conversationIDPattern.MatchString(value)
}
