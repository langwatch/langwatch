package scenario

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Identifier prefixes, matching the JS SDK.
const (
	threadIDPrefix   = "scenariothread_"
	runIDPrefix      = "scenariorun_"
	scenarioIDPrefix = "scenario_"
	batchIDPrefix    = "scenariobatch_"
	messageIDPrefix  = "scenariomsg_"
)

// ksuidEpoch is the KSUID epoch offset in seconds (2014-05-13).
const ksuidEpoch = 1_400_000_000

const base62Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// newKSUID returns a 27-character K-sortable unique id: a 4-byte timestamp
// and 16 random bytes in base62, the format the JS SDK's xksuid generates.
func newKSUID() [27]byte {
	var raw [20]byte
	binary.BigEndian.PutUint32(raw[:4], uint32(time.Now().Unix()-ksuidEpoch))
	_, _ = rand.Read(raw[4:])
	return base62Encode(raw)
}

// base62Encode converts 20 bytes to 27 base62 digits by long division over
// 32-bit words, as the reference KSUID implementation does.
func base62Encode(src [20]byte) [27]byte {
	var out [27]byte
	for i := range out {
		out[i] = '0'
	}
	parts := [5]uint32{
		binary.BigEndian.Uint32(src[0:4]),
		binary.BigEndian.Uint32(src[4:8]),
		binary.BigEndian.Uint32(src[8:12]),
		binary.BigEndian.Uint32(src[12:16]),
		binary.BigEndian.Uint32(src[16:20]),
	}
	bp := parts[:]
	n := len(out)
	var quotient [5]uint32
	for len(bp) != 0 {
		q := quotient[:0]
		var remainder uint64
		for _, c := range bp {
			value := uint64(c) + remainder*(1<<32)
			digit := value / 62
			remainder = value % 62
			if len(q) != 0 || digit != 0 {
				q = append(q, uint32(digit))
			}
		}
		n--
		out[n] = base62Alphabet[remainder]
		copy(parts[:], q)
		bp = parts[:len(q)]
	}
	return out
}

// newID mints a prefixed id; tests replace it for deterministic payloads.
var newID = prefixedID

func prefixedID(prefix string) string {
	id := newKSUID()
	var b strings.Builder
	b.Grow(len(prefix) + len(id))
	b.WriteString(prefix)
	b.Write(id[:])
	return b.String()
}

func generateThreadID() string   { return newID(threadIDPrefix) }
func generateRunID() string      { return newID(runIDPrefix) }
func generateScenarioID() string { return newID(scenarioIDPrefix) }
func generateMessageID() string  { return newID(messageIDPrefix) }

var (
	batchRunIDOnce sync.Once
	batchRunID     string
)

// BatchRunID returns the batch run id this process reports its runs under,
// computed once: SCENARIO_BATCH_RUN_ID when set; under `go test`, an id
// derived from the parent process and the ISO week, so every test binary one
// `go test ./...` invocation starts shares a batch (like the JS SDK under
// vitest/jest); otherwise a fresh id.
func BatchRunID() string {
	batchRunIDOnce.Do(func() {
		batchRunID = resolveBatchRunID(os.Getenv("SCENARIO_BATCH_RUN_ID"), runningUnderGoTest(), os.Getppid(), time.Now())
	})
	return batchRunID
}

func resolveBatchRunID(env string, underTest bool, ppid int, now time.Time) string {
	if env != "" {
		return env
	}
	if underTest {
		year, week := now.UTC().ISOWeek()
		raw := strconv.Itoa(ppid) + "_" + strconv.Itoa(year) + "_w" + twoDigits(week)
		sum := sha256.Sum256([]byte(raw))
		return batchIDPrefix + hex.EncodeToString(sum[:])[:12]
	}
	return prefixedID(batchIDPrefix)
}

func twoDigits(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

// runningUnderGoTest reports whether the process is a `go test` binary.
func runningUnderGoTest() bool {
	if strings.HasSuffix(os.Args[0], ".test") || strings.HasSuffix(os.Args[0], ".test.exe") {
		return true
	}
	for _, a := range os.Args[1:] {
		if strings.HasPrefix(a, "-test.") {
			return true
		}
	}
	return false
}
