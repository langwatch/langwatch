package cell

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestStoreNameKeepsShortNamesAndBoundsLongOnes(t *testing.T) {
	if got := StoreName("cloud_s_typical_1"); got != "upgradelab_cloud_s_typical_1" {
		t.Fatalf("short name changed: %s", got)
	}
	long := "cloud_sso_s_typical_22_upcast_events_held_tenants_queued_jobs_v1_operator_damage"
	got := StoreName(long)
	if len(got) != 63 || !strings.HasPrefix(got, DedicatedPrefix+"cloud_sso_s_typical_22") {
		t.Fatalf("long name %q (%d bytes)", got, len(got))
	}
	if StoreName(long+"_x") == got {
		t.Fatal("two long names share a database")
	}
	if StoreName(long) != got {
		t.Fatal("the name is not stable")
	}
}

// listRedis answers ZRANGE WITHSCORES and SMEMBERS in redis-cli --no-raw form.
type listRedis struct {
	zsets map[string][][2]string
	sets  map[string][]string
}

func (redis listRedis) scan(_ context.Context, _ string) ([]string, error) {
	var keys []string
	for key := range redis.zsets {
		keys = append(keys, key)
	}
	return keys, nil
}

func (redis listRedis) replies(_ context.Context, commands [][]string) ([][]string, error) {
	var replies [][]string
	for _, command := range commands {
		var lines []string
		switch command[0] {
		case "ZRANGE":
			for i, pair := range redis.zsets[command[1]] {
				lines = append(lines, itoa(2*i+1)+") \""+pair[0]+"\"", itoa(2*i+2)+") \""+pair[1]+"\"")
			}
		case "SMEMBERS":
			for i, member := range redis.sets[command[1]] {
				lines = append(lines, itoa(i+1)+") \""+member+"\"")
			}
			if len(lines) == 0 {
				lines = []string{"(empty array)"}
			}
		}
		replies = append(replies, lines)
	}
	return replies, nil
}

const jobsPrefix = "{event-sourcing/jobs}:gq:"

func jobsKey(group string) string { return jobsPrefix + "group:" + group + ":jobs" }

func TestReadQueuedJobsReadsGroupsDeadLettersAndBlocked(t *testing.T) {
	redis := listRedis{
		zsets: map[string][][2]string{jobsKey("org_1/reactor/billingMeterDispatch/agg_1"): {{"job-a", "1000"}, {"job-b", "2000"}}},
		sets:  map[string][]string{jobsPrefix + "dlq": {"org_2/command/countMonth/agg_2"}, jobsPrefix + "blocked": nil},
	}
	reading := readQueuedJobs(context.Background(), redis)
	if reading.Err != nil {
		t.Fatal(reading.Err)
	}
	jobs := reading.Groups[jobsKey("org_1/reactor/billingMeterDispatch/agg_1")]
	if jobs["job-a"] != 1000 || jobs["job-b"] != 2000 {
		t.Fatalf("jobs %v", jobs)
	}
	if len(reading.DeadLettered) != 1 || len(reading.Blocked) != 0 {
		t.Fatalf("dead %v blocked %v", reading.DeadLettered, reading.Blocked)
	}
	if kind := jobKind(groupID(jobsKey("org_1/reactor/billingMeterDispatch/agg_1"))); kind != "reactor/billingMeterDispatch" {
		t.Fatalf("kind %s", kind)
	}
}

func cutWith(groups map[string]map[string]float64) queuedJobs {
	return queuedJobs{Groups: groups, ReadAtMs: 0}
}

func TestJudgeQueuedJobs(t *testing.T) {
	key := jobsKey("org_1/command/countMonth/agg_1")
	cut := cutWith(map[string]map[string]float64{key: {"job-a": 100, "job-b": 200}})
	cases := map[string]struct {
		after queuedJobs
		want  string
	}{
		"all ran":           {queuedJobs{Groups: map[string]map[string]float64{}, ReadAtMs: 5000}, "pass"},
		"one due later":     {queuedJobs{Groups: map[string]map[string]float64{key: {"job-b": 9000}}, ReadAtMs: 5000}, "pass"},
		"one stranded":      {queuedJobs{Groups: map[string]map[string]float64{key: {"job-a": 100}}, ReadAtMs: 5000}, "fail"},
		"group dead-letter": {queuedJobs{Groups: map[string]map[string]float64{}, DeadLettered: []string{"org_1/command/countMonth/agg_1"}, ReadAtMs: 5000}, "fail"},
		"group blocked":     {queuedJobs{Groups: map[string]map[string]float64{}, Blocked: []string{"org_1/command/countMonth/agg_1"}, ReadAtMs: 5000}, "fail"},
		"unread":            {queuedJobs{Err: errors.New("redis down")}, "inconclusive"},
	}
	for name, each := range cases {
		if got := judgeQueuedJobs(cut, each.after); got.Result != each.want {
			t.Errorf("%s: %s, want %s (%s)", name, got.Result, each.want, got.Detail)
		}
	}
	if got := judgeQueuedJobs(cutWith(map[string]map[string]float64{}), queuedJobs{Groups: map[string]map[string]float64{}}); got.Result != "fail" {
		t.Errorf("an empty cut proves nothing, got %s", got.Result)
	}
}

func TestParseTypeCounts(t *testing.T) {
	counts, err := parseTypeCounts("lw.obs.trace.span_received\t40\nlw.usage.month_counted\t2\n")
	if err != nil || counts["lw.obs.trace.span_received"] != 40 || counts["lw.usage.month_counted"] != 2 {
		t.Fatalf("%v %v", counts, err)
	}
	if _, err := parseTypeCounts("broken"); err == nil {
		t.Fatal("a malformed line passed")
	}
}

func TestJudgeUpcasts(t *testing.T) {
	steps := []LedgerRow{{ID: "upcast:entitlement:lw.usage.month_counted", Status: "done"}, {ID: "prisma:x", Status: "running"}}
	pass := Verdict{ID: "I7", Result: "pass"}
	cut, after := map[string]int{"lw.usage.month_counted": 2}, map[string]int{"lw.usage.month_counted": 2}
	if got := judgeUpcasts(steps, cut, after, pass, nil); got.Result != "pass" {
		t.Errorf("settled upcast: %s %s", got.Result, got.Detail)
	}
	if got := judgeUpcasts(steps, cut, map[string]int{}, pass, nil); got.Result != "fail" {
		t.Errorf("a lost row passed: %s", got.Detail)
	}
	if got := judgeUpcasts(steps, cut, after, Verdict{ID: "I7", Result: "fail"}, nil); got.Result != "fail" {
		t.Errorf("an I7 refusal passed: %s", got.Detail)
	}
	running := []LedgerRow{{ID: "upcast:entitlement:lw.usage.month_counted", Status: "running"}}
	if got := judgeUpcasts(running, cut, after, pass, nil); got.Result != "fail" {
		t.Errorf("an unsettled step passed: %s", got.Detail)
	}
	if got := judgeUpcasts(nil, cut, after, pass, nil); got.Result != "fail" {
		t.Errorf("no upcast step passed: %s", got.Detail)
	}
	if got := judgeUpcasts(steps, nil, after, pass, nil); got.Result != "inconclusive" {
		t.Errorf("no cut reading: %s", got.Result)
	}
}
