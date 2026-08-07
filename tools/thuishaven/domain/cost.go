package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"
)

// The gate's second duty: pricing an action before it silently invalidates a
// prompt cache, and refusing the two things that are unambiguous waste. See
// ADR-088.

// Cache rate multipliers, relative to base input price. Published rates.
const (
	cacheReadRate     = 0.1
	cacheWrite5mRate  = 1.25
	cacheWrite1hRate  = 2.0
	opus5InputPerMTok = 5.0
)

// BustPremium is what invalidating a prefix you were about to read costs,
// as a multiple of base input price.
//
// It is the DIFFERENCE between writing and reading, not the write rate — an
// earlier draft quoted 1.15 as the rate and was wrong by the read it forgot to
// subtract. A sub-agent holds the five-minute cache (1.25 - 0.1) and a main
// session the one-hour one (2.0 - 0.1), so the same bust costs a main session
// nearly twice what it costs a sub-agent.
func BustPremium(caller CallerKind) float64 {
	if caller == SubAgent {
		return cacheWrite5mRate - cacheReadRate
	}
	return cacheWrite1hRate - cacheReadRate
}

// BustCostUSD prices re-caching a prefix of this many tokens.
//
// Opus 5's input rate is the one quoted because it is what these sessions run
// on; the figure is an order-of-magnitude aid for a warning, not an invoice,
// and the prefix size feeding it is itself an estimate.
func BustCostUSD(prefixTokens int, caller CallerKind) float64 {
	if prefixTokens <= 0 {
		return 0
	}
	return float64(prefixTokens) / 1_000_000 * opus5InputPerMTok * BustPremium(caller)
}

// EstimateTokensFromBytes converts a transcript's size on disk to a rough token
// count.
//
// Four bytes per token is the usual English approximation and is deliberately
// crude: the alternative is an API call, and pricing a warning must not cost
// tokens. The transcript is also not the prefix — it excludes tools and system
// and diverges after compaction — so this is presented as approximate wherever
// it is shown, and is used to decide WHETHER to warn far more than to say by
// how much.
func EstimateTokensFromBytes(size int64) int {
	if size <= 0 {
		return 0
	}
	return int(size / 4)
}

// WarnThresholdTokens is the prefix size below which a cache-invalidating
// action is not worth mentioning.
//
// Warning credibility is the whole reason this exists. A warning on a cheap
// action trains the reader to dismiss the expensive one, so the bar is set
// where the cost starts being worth an interruption — roughly a dollar on a
// main session.
const WarnThresholdTokens = 100_000

// CostChannel is how a finding reaches a person. There is no primitive that
// shows the MODEL a price and still lets the action proceed, so warnings are
// for the developer.
type CostChannel int

const (
	// Silent says nothing: below the threshold, or nothing worth reading.
	Silent CostChannel = iota
	// Notify surfaces a line to the developer and lets the action proceed.
	Notify
	// Confirm interrupts the developer before the action happens.
	Confirm
	// Deny blocks, and is reserved for unambiguous waste.
	Deny
)

// CacheInvalidation is a kind of action that busts a cached prefix, ranked by
// how sure we are that it does.
type CacheInvalidation int

const (
	// ToolSetChange is documented: tools render at position 0, so changing them
	// invalidates everything including the tools cache.
	ToolSetChange CacheInvalidation = iota
	// ModelSwitch is documented, and has no escape hatch — caches are scoped to
	// one model, so switching back pays again.
	ModelSwitch
	// InstructionsEdit is NOT verified. Whether editing an instructions file
	// invalidates depends on where the harness places it in the prefix, which
	// has not been established — so its copy carries the hedge rather than
	// asserting through it.
	InstructionsEdit
)

// ChannelFor picks how loudly to report an invalidation.
//
// High-certainty, high-value invalidations on a large prefix are worth one
// interruption. Everything else is a line the developer can read or ignore.
// Nothing here ever blocks: a cache-busting edit is usually deliberate, and the
// gate's job is to make the price visible, not to prevent the action.
func ChannelFor(kind CacheInvalidation, prefixTokens int) CostChannel {
	if prefixTokens < WarnThresholdTokens {
		return Silent
	}
	if kind == InstructionsEdit {
		return Notify
	}
	return Confirm
}

// InvalidationWarning is the line a developer reads. It leads with the price,
// because the price is what decides whether they care.
func InvalidationWarning(kind CacheInvalidation, prefixTokens int, caller CallerKind) string {
	cost := BustCostUSD(prefixTokens, caller)
	lifetime := "one-hour"
	if caller == SubAgent {
		lifetime = "five-minute"
	}
	base := fmt.Sprintf("about $%.2f to re-cache ~%dk tokens (%s cache, %.2gx premium)",
		cost, prefixTokens/1000, lifetime, BustPremium(caller))

	switch kind {
	case ToolSetChange:
		return "changing the tool set invalidates the whole prefix, tools included — " + base
	case ModelSwitch:
		return "switching model discards the whole cache with no escape hatch, and switching back pays again — " + base
	default:
		return "editing instructions MAY invalidate the prefix (where the harness places them is unverified) — " + base
	}
}

// --- unambiguous waste -------------------------------------------------------

// RepeatKey identifies "the same call again". Hashed so a long command does not
// bloat the state file, and so nothing sensitive is written to disk.
func RepeatKey(toolName, input string) string {
	sum := sha256.Sum256([]byte(toolName + "\x00" + input))
	return hex.EncodeToString(sum[:8])
}

// RepeatThreshold is how many identical consecutive calls are tolerated before
// the gate stops one.
//
// Three, not one: a retry after a transient failure is ordinary, and denying
// the second attempt at anything would be worse than the loop it prevents.
const RepeatThreshold = 3

// RepeatState is what the gate remembers about the last call in a session.
type RepeatState struct {
	Key   string
	Count int
	// EditedSince records that a file changed after the last call. It is what
	// keeps the red-green loop working: rerunning the same test command after an
	// edit is the most common sequence there is, and a detector that cannot see
	// the edit denies it.
	EditedSince bool
}

// ObserveCall folds a call into the repeat state and reports whether it should
// be denied.
//
// A different call, or any intervening file edit, resets the count. Only a run
// of identical calls with nothing changing in between is waste.
func ObserveCall(prev RepeatState, key string) (RepeatState, bool) {
	if prev.Key != key || prev.EditedSince {
		return RepeatState{Key: key, Count: 1}, false
	}
	next := RepeatState{Key: key, Count: prev.Count + 1}
	return next, next.Count > RepeatThreshold
}

// RepeatDenialReason explains the stop in terms the model can act on.
func RepeatDenialReason(count int) string {
	return fmt.Sprintf(
		"this exact command has run %d times in a row with nothing changing in between. "+
			"Repeating it will produce the same result. Change the input, change the approach, "+
			"or read the previous output again — do not retry it unchanged.", count)
}

// MaxConcurrentAgents caps machine-wide sub-agent fan-out.
//
// Ten is the working fleet size this whole ADR exists for; the cap sits just
// above it so ordinary work is never refused and a runaway spawn loop is.
const MaxConcurrentAgents = 12

// SpawnEntryTTL bounds how long a counted spawn is believed.
//
// The cap MUST be able to lose count. PreToolUse fires before the permission
// check, so a spawn the user then rejects is counted and never runs, and drift
// is one-directional. A stale-high counter would refuse every spawn on the
// machine forever, which is the fail-closed outcome ADR-088 calls
// non-negotiable — so entries expire and an unverifiable count admits.
const SpawnEntryTTL = 30 * time.Minute

// LiveSpawns counts entries that have not expired, given when each was recorded.
func LiveSpawns(recorded []time.Time, now time.Time) int {
	live := 0
	for _, at := range recorded {
		if now.Sub(at) < SpawnEntryTTL {
			live++
		}
	}
	return live
}

// SpawnDenialReason names the count so the refusal is checkable rather than
// mysterious.
func SpawnDenialReason(live int) string {
	return fmt.Sprintf(
		"%d sub-agents are already running on this machine (cap %d). Wait for one to finish "+
			"before spawning another — do not sleep or poll, just continue with work that "+
			"does not need a new agent.", live, MaxConcurrentAgents)
}

// ParallelSpawnCachePrice is the cost N sub-agents launched together pay that
// one launched alone does not.
//
// A cache entry is readable only once the first response using it begins
// streaming, so simultaneous spawns sharing a prefix all pay the write rather
// than the read. It is a better argument for the cap than RAM is.
func ParallelSpawnCachePrice(n, prefixTokens int) float64 {
	if n < 2 || prefixTokens <= 0 {
		return 0
	}
	// The first pays the write regardless; the rest would have read.
	return float64(n-1) * float64(prefixTokens) / 1_000_000 * opus5InputPerMTok *
		(cacheWrite5mRate - cacheReadRate)
}
