package cell

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"testing"
)

func TestRepliesParse(t *testing.T) {
	if got := replyValue(`2) "a \"b\"\n"`); got != "a \"b\"\n" {
		t.Errorf("value %q", got)
	}
	if got := replyInt([]string{"(integer) 7"}); got != 7 {
		t.Errorf("int %d", got)
	}
	if got := replyInt([]string{"(nil)"}); got != 0 {
		t.Errorf("nil %d", got)
	}
}

// fakeRedis answers the depth's reads in redis-cli --no-raw form from a group-queue-shaped keyspace.
type fakeRedis struct {
	strings map[string]string
	sets    map[string][]string
	zsets   map[string]int
	scans   int
}

func (redis *fakeRedis) scan(_ context.Context, pattern string) ([]string, error) {
	redis.scans++
	var keys []string
	for key := range redis.zsets { // the depth only ever scans "*<suffix>"
		if strings.HasSuffix(key, strings.TrimPrefix(pattern, "*")) {
			keys = append(keys, key)
		}
	}
	return keys, nil
}

func (redis *fakeRedis) replies(_ context.Context, commands [][]string) ([][]string, error) {
	answers := make([][]string, len(commands))
	for i, command := range commands {
		key := command[1]
		switch command[0] {
		case "SMEMBERS":
			answers[i] = []string{"(empty array)"}
			if members := redis.sets[key]; len(members) > 0 {
				answers[i] = nil
				for n, member := range members {
					answers[i] = append(answers[i], fmt.Sprintf("%d) %q", n+1, member))
				}
			}
		case "GET":
			answers[i] = []string{"(nil)"}
			if value, ok := redis.strings[key]; ok {
				answers[i] = []string{strconv.Quote(value)}
			}
		case "ZCARD":
			answers[i] = []string{fmt.Sprintf("(integer) %d", redis.zsets[key])}
		case "SCARD":
			answers[i] = []string{fmt.Sprintf("(integer) %d", len(redis.sets[key]))}
		default:
			return nil, fmt.Errorf("unexpected %v", command)
		}
	}
	return answers, nil
}

// groupQueueShaped holds a deep backlog as the product leaves it: thousands of per-group jobs and
// data keys the depth must not walk, and the counter and ready index it must read.
func groupQueueShaped() *fakeRedis {
	redis := &fakeRedis{strings: map[string]string{}, sets: map[string][]string{}, zsets: map[string]int{}}
	queue := "{event-sourcing/jobs}"
	for group := range 3000 {
		key := fmt.Sprintf("%s:gq:group:proj_%d/command/metric_processing/recordDataPoint/metric:%d", queue, group%7, group)
		redis.zsets[key+":jobs"] = 260
		redis.strings[key+":data"] = "hash"
	}
	redis.strings[queue+":gq:stats:total-pending"] = "780000"
	redis.zsets[queue+":gq:ready"] = 3000
	redis.sets[queue+":gq:blocked"] = []string{"proj_1/x"}
	redis.sets[groupQueueRegistry] = []string{queue, "{other}"}
	redis.zsets["{other}:gq:ready"] = 4 // no counter yet: the ready groups stand in, as drainAudit does
	return redis
}

func TestQueueCountsReadTheProductsCounters(t *testing.T) {
	redis := groupQueueShaped()
	counts, err := queueCounts(context.Background(), redis)
	if err != nil {
		t.Fatal(err)
	}
	if total := totalPending(counts); total != 780004 {
		t.Errorf("depth %d, want 780000 counted plus 4 ready groups without a counter: %+v", total, counts)
	}
	if redis.scans != 0 {
		t.Errorf("scanned %d times though the registry named every queue", redis.scans)
	}
	if counts[0].Name != "{event-sourcing/jobs}" || counts[0].Blocked != 1 || counts[0].Ready != 3000 {
		t.Errorf("counts %+v", counts)
	}
}

func TestQueueCountsFindQueuesWithoutTheRegistry(t *testing.T) {
	redis := groupQueueShaped()
	delete(redis.sets, groupQueueRegistry)
	counts, err := queueCounts(context.Background(), redis)
	if err != nil || totalPending(counts) != 780004 || redis.scans != 1 {
		t.Fatalf("counts %+v, scans %d, err %v", counts, redis.scans, err)
	}
	empty := &fakeRedis{}
	if counts, err := queueCounts(context.Background(), empty); err != nil || totalPending(counts) != 0 {
		t.Fatalf("an empty Redis: %+v %v", counts, err)
	}
}

func TestQueueVerdictPassesOnlyBackAroundTheBaseline(t *testing.T) {
	const paused, worker = 1000, 5000
	samples := []QueueSample{{AtMs: 500, Depth: 40}, {AtMs: 900, Depth: 60}, {AtMs: 3000, Depth: 780000}, {AtMs: 6000, Depth: 400000}}
	stuck := summariseQueue(samples, paused, worker)
	if stuck.Baseline != 60 || stuck.Limit != 160 || stuck.Peak != 780000 || stuck.DrainedMs != -1 || stuck.Final != 400000 {
		t.Fatalf("stuck summary %+v", stuck)
	}
	if queueVerdict(stuck).Result != "fail" {
		t.Error("a backlog still 400k deep passed N4")
	}
	drained := summariseQueue(append(samples, QueueSample{AtMs: 9000, Depth: 150}, QueueSample{AtMs: 11000, Depth: 20}), paused, worker)
	if drained.DrainedMs != 4000 || queueVerdict(drained).Result != "pass" {
		t.Errorf("drained summary %+v, verdict %v", drained, queueVerdict(drained))
	}
	relapsed := summariseQueue(append(samples, QueueSample{AtMs: 9000, Depth: 10}, QueueSample{AtMs: 11000, Depth: 5000}), paused, worker)
	if queueVerdict(relapsed).Result != "fail" {
		t.Error("a backlog that grew again by the end passed N4")
	}
	if blind := summariseQueue(nil, paused, worker); queueVerdict(blind).Result != "fail" {
		t.Error("no readings at all passed N4")
	}
	if got := drainLimit(10000); got != 12500 {
		t.Errorf("limit %d", got)
	}
}

func TestQueueRowsKeepThePeakAndTheLast(t *testing.T) {
	var samples []QueueSample
	for i := range 500 {
		samples = append(samples, QueueSample{AtMs: int64(i) * 2000, Depth: i})
	}
	samples[137].Depth = 1_000_000
	rows := queueRows(samples, 24)
	if len(rows) > 26 || rows[len(rows)-1].AtMs != samples[499].AtMs || rows[0].AtMs != 0 {
		t.Fatalf("%d rows, first %v, last %v", len(rows), rows[0], rows[len(rows)-1])
	}
	peak := false
	for i, row := range rows {
		peak = peak || row.Depth == 1_000_000
		if i > 0 && row.AtMs <= rows[i-1].AtMs {
			t.Errorf("rows out of order at %d", i)
		}
	}
	if !peak {
		t.Error("the peak was thinned away")
	}
	var text strings.Builder
	QueueSummary{Samples: samples[:3]}.write(&text)
	if !strings.Contains(text.String(), "| 4000 | 2 |") {
		t.Errorf("report:\n%s", text.String())
	}
}

func TestStoppedCellLeavesWritesUnchecked(t *testing.T) {
	calls := []Call{{Kind: "otlp-trace", ID: "a", Write: true, Status: 200}, {Kind: "rest-read", ID: "b", Status: 200}}
	summaries, _ := Summarize(calls, nil, nil)
	if summaries[0].Lost != 0 || !summaries[0].Unchecked || writeCell(summaries[0], summaries[0].Lost) != "unchecked" {
		t.Errorf("unchecked write %+v", summaries[0])
	}
	if writeCell(summaries[1], 0) != "-" {
		t.Error("a read shows a write cell")
	}
	checked, _ := Summarize(calls, nil, map[string]bool{})
	if checked[0].Lost != 1 || checked[0].Unchecked {
		t.Errorf("checked write %+v", checked[0])
	}
}
