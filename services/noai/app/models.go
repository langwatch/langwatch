// Package app holds the noai service's domain + handler logic. There is
// no upstream provider — every response is a deterministic function of
// the requested model id and the last user turn.
package app

import (
	"encoding/json"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// ModelID is the bare model identifier (no `langwatch_noai/` prefix).
type ModelID string

const (
	ModelEchoText             ModelID = "echo-text"
	ModelEchoAudio            ModelID = "echo-audio"
	ModelJudgeTextPass        ModelID = "judge-text-pass"
	ModelJudgeTextFail        ModelID = "judge-text-fail"
	ModelJudgeAudioPass       ModelID = "judge-audio-pass"
	ModelJudgeAudioFail       ModelID = "judge-audio-fail"
	ModelUserSimulationText   ModelID = "user-simulation-text"
	ModelUserSimulationAudio  ModelID = "user-simulation-audio"
)

// All returns every model the service knows about, in a stable order.
func All() []ModelID {
	return []ModelID{
		ModelEchoText,
		ModelEchoAudio,
		ModelJudgeTextPass,
		ModelJudgeTextFail,
		ModelJudgeAudioPass,
		ModelJudgeAudioFail,
		ModelUserSimulationText,
		ModelUserSimulationAudio,
	}
}

// IsKnown reports whether id (with or without the `langwatch_noai/` prefix)
// is one of the noai models.
func IsKnown(id string) bool {
	_, ok := Normalize(id)
	return ok
}

// Normalize strips the optional `langwatch_noai/` prefix and validates the
// remainder against the known model set. Returns (id, true) on success or
// ("", false) for unknown ids. Any other provider prefix (e.g. `openai/`)
// is treated as an unknown model — we don't want misrouted ids to silently
// satisfy a noai handler.
func Normalize(id string) (ModelID, bool) {
	const prefix = "langwatch_noai/"
	stripped := id
	if strings.HasPrefix(stripped, prefix) {
		stripped = stripped[len(prefix):]
	} else if strings.ContainsRune(stripped, '/') {
		return "", false
	}
	for _, known := range All() {
		if string(known) == stripped {
			return known, true
		}
	}
	return "", false
}

// HasAudioOutput reports whether the model returns an audio file part in
// addition to text. The transport layer uses this to set OpenAI's
// `modalities` and `audio` fields in the response.
func (m ModelID) HasAudioOutput() bool {
	switch m {
	case ModelEchoAudio, ModelUserSimulationAudio:
		return true
	default:
		return false
	}
}

// Reply builds the assistant text the model produces for the given last
// user turn. Audio output (when applicable) is handled separately by the
// transport layer because the framing differs between /v1/chat/completions
// and /v1/responses.
func (m ModelID) Reply(lastUserText string) string {
	switch m {
	case ModelEchoText, ModelEchoAudio:
		return echoString(lastUserText)
	case ModelJudgeTextPass:
		return verdictJSON(true, 1, "fake-pass")
	case ModelJudgeTextFail:
		return verdictJSON(false, 0, "fake-fail")
	case ModelJudgeAudioPass:
		return verdictJSON(true, 1, "fake-pass-audio")
	case ModelJudgeAudioFail:
		return verdictJSON(false, 0, "fake-fail-audio")
	case ModelUserSimulationText, ModelUserSimulationAudio:
		return userSimulationLine(lastUserText)
	}
	// Fallback for additions to the enum that haven't been wired here yet.
	return echoString(lastUserText)
}

func echoString(lastUserText string) string {
	return `Fake LLM Response to: "` + lastUserText + `"`
}

func userSimulationLine(lastUserText string) string {
	if lastUserText == "" {
		return "Fake user turn (no prior context)."
	}
	return `Fake user follow-up to: "` + lastUserText + `"`
}

// newIDStamp returns a unique-per-invocation suffix used in response /
// message / audio ids. Combines nanosecond timestamp with an atomic
// counter so concurrent requests within the same nanosecond — and tests
// that bake in a fixed `time.Time` — still produce distinct ids.
func newIDStamp(now time.Time) string {
	seq := atomic.AddUint64(&idCounter, 1)
	return strconv.FormatInt(now.UTC().UnixNano(), 10) + "-" + strconv.FormatUint(seq, 10)
}

var idCounter uint64

func verdictJSON(passed bool, score float64, reason string) string {
	verdict := struct {
		Passed    bool    `json:"passed"`
		Score     float64 `json:"score"`
		Reasoning string  `json:"reasoning"`
	}{Passed: passed, Score: score, Reasoning: reason}
	out, _ := json.Marshal(verdict)
	return string(out)
}
