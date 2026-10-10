package voicesession

import (
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// ElevenLabs sockets report no usage, so the relay counts what the client
// sends: characters of text on the speech sockets, audio on transcription.

// audioUnitsPerSecond is the resolution audio is counted at: microseconds,
// so a chunk of any size adds a whole number.
const audioUnitsPerSecond = 1_000_000

// CountSpeechChars reads the characters one speech socket frame asks for:
// its own text, and each line of a dialog. The keep-alive " " is one
// character and the closing "" is none, like any other text.
func CountSpeechChars(frame []byte) int64 {
	fields := gjson.GetManyBytes(frame, "text", "inputs.#.text")
	chars := 0
	if fields[0].Type == gjson.String {
		chars += utf8.RuneCountInString(fields[0].String())
	}
	fields[1].ForEach(func(_, line gjson.Result) bool {
		if line.Type == gjson.String {
			chars += utf8.RuneCountInString(line.String())
		}
		return true
	})
	return int64(chars)
}

// AudioBytesPerSecond is the byte rate of an ElevenLabs audio_format: 16 bit
// mono PCM at the named rate, or 8 bit mu-law. Unknown formats take the
// vendor's default, pcm_16000.
func AudioBytesPerSecond(format string) int64 {
	const defaultRate = 32000
	codec, rate, ok := strings.Cut(strings.TrimSpace(format), "_")
	hertz, err := strconv.ParseInt(rate, 10, 64)
	if !ok || err != nil || hertz <= 0 {
		return defaultRate
	}
	switch codec {
	case "pcm":
		return hertz * 2
	case "ulaw":
		return hertz
	default:
		return defaultRate
	}
}

// CountAudio answers a counter of the audio one transcription frame carries,
// in microseconds, from the decoded length of its base64 chunk.
func CountAudio(bytesPerSecond int64) func(frame []byte) int64 {
	return func(frame []byte) int64 {
		chunk := gjson.GetBytes(frame, "audio_base_64")
		if chunk.Type != gjson.String {
			return 0
		}
		return base64DecodedLen(chunk.Str) * audioUnitsPerSecond / bytesPerSecond
	}
}

// base64DecodedLen is the byte length a base64 string decodes to, read off
// its length and padding so the audio is never decoded.
func base64DecodedLen(encoded string) int64 {
	encoded = strings.TrimRight(encoded, "=")
	return int64(len(encoded)) * 3 / 4
}

// StripSocketKeys removes the key fields ElevenLabs accepts in a first
// message, so a virtual key sent there never reaches the vendor. A frame
// that carries none comes back as the same bytes.
func StripSocketKeys(frame []byte) []byte {
	out := frame
	for _, field := range []string{"xi-api-key", "xi_api_key", "authorization"} {
		if !gjson.GetBytes(out, field).Exists() {
			continue
		}
		stripped, err := sjson.DeleteBytes(out, field)
		if err != nil {
			continue
		}
		out = stripped
	}
	return out
}

// relayCounter turns the running count of a socket into keyed deltas.
type relayCounter struct {
	kind     domain.RealtimeSessionKind
	reported int64
	lastSent time.Time
}

func newRelayCounter(kind domain.RealtimeSessionKind) relayCounter {
	return relayCounter{kind: kind}
}

// pending answers the report for what was counted since the last one. Keys
// are c-<cumulative characters> and a-<cumulative milliseconds>.
func (c *relayCounter) pending(units int64, now time.Time, minInterval time.Duration) (Observation, bool) {
	total := units
	if c.kind == domain.RealtimeKindSTTSocket {
		total = units / (audioUnitsPerSecond / 1000)
	}
	delta := total - c.reported
	if delta <= 0 {
		return Observation{}, false
	}
	if !c.lastSent.IsZero() && now.Sub(c.lastSent) < minInterval {
		return Observation{}, false
	}
	c.reported, c.lastSent = total, now
	if c.kind == domain.RealtimeKindSTTSocket {
		return Observation{
			ReportKey: fmt.Sprintf("a-%d", total),
			Usage:     domain.Usage{AudioSeconds: float64(delta) / 1000},
		}, true
	}
	return Observation{
		ReportKey: fmt.Sprintf("c-%d", total),
		Usage:     domain.Usage{InputChars: int(delta)},
	}, true
}
