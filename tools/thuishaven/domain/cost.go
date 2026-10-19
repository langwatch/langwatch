package domain

import (
	"fmt"
)

// The gate's second duty: pricing an action before it silently invalidates a
// prompt cache, and refusing the two things that are unambiguous waste. See
// ADR-091.

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
