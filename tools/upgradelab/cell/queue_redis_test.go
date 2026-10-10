package cell

import (
	"reflect"
	"testing"
)

func TestQueueExcludedKeepsTheOldFilter(t *testing.T) {
	for key, excluded := range map[string]bool{
		"{q}:gq:group:t/fold/x:jobs": false, "bull:a:wait": false, "bull:a:completed": true, "x:gq:ready": true,
		"x:gq:ready2": false, "x:gq:stats:y": true, "a:lock:b": true, "known-pipelines": true, "bull:a:stalled-check": true, "d:dedup:1": true,
	} {
		if got := queueExcluded.MatchString(key); got != excluded {
			t.Errorf("%s: excluded %v, want %v", key, got, excluded)
		}
	}
}

func TestRepliesParse(t *testing.T) {
	if got := replyValue(`2) "a \"b\"\n"`); got != "a \"b\"\n" {
		t.Errorf("value %q", got)
	}
	if got := replyInt([]string{"(integer) 7"}); got != 7 {
		t.Errorf("int %d", got)
	}
	jobs := map[string]struct{}{}
	addJobs(jobs, queueKey{name: "s", kind: "stream"}, []string{`1) 1) "1-0"`, `   2) 1) "f"`, `      2) "v"`, `2) 1) "2-0"`, `   2) 1) "f"`, `      2) "v"`})
	addJobs(jobs, queueKey{name: "l", kind: "list"}, []string{`1) "m"`})
	addJobs(jobs, queueKey{name: "z", kind: "zset"}, []string{`1) "j"`})
	want := map[string]struct{}{"s 1-0": {}, "s 2-0": {}, "l #1m": {}, "z j": {}}
	if !reflect.DeepEqual(jobs, want) {
		t.Errorf("jobs %v, want %v", jobs, want)
	}
}
