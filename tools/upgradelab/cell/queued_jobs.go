package cell

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
	"time"
)

// OverlayQueuedJobs keeps the jobs main's paused worker queued in main's own format (every group-queue job at the
// cut, read by id) and judges, after settle, that head's worker ran each one or left it safely: none still due in
// its group, none dead-lettered, no group of them blocked (Q1).
const OverlayQueuedJobs = "queued-jobs-v1"

// queuedJobs is one reading of the group queue: each group's job ids with their due times, and the groups the
// queue dead-lettered or blocked.
type queuedJobs struct {
	Groups       map[string]map[string]float64 // group key ("<prefix>gq:group:<id>:jobs") -> job id -> due ms
	DeadLettered []string                      // group ids in any queue's dlq index
	Blocked      []string                      // group ids in any queue's blocked set
	ReadAtMs     int64
	Err          error
}

// readQueuedJobs reads every group's jobs with their scores, then each queue's dlq index and blocked set.
func readQueuedJobs(ctx context.Context, redis redisReads) queuedJobs {
	reading := queuedJobs{Groups: map[string]map[string]float64{}, ReadAtMs: time.Now().UnixMilli()}
	keys, err := redis.scan(ctx, "*:gq:group:*:jobs")
	if err != nil {
		reading.Err = err
		return reading
	}
	prefixes := map[string]bool{}
	commands := make([][]string, 0, len(keys))
	for _, key := range keys {
		prefixes[key[:strings.Index(key, ":gq:")+len(":gq:")]] = true
		commands = append(commands, []string{"ZRANGE", key, "0", "-1", "WITHSCORES"})
	}
	ordered := slices.Sorted(maps.Keys(prefixes))
	for _, prefix := range ordered {
		commands = append(commands, []string{"SMEMBERS", prefix + "dlq"}, []string{"SMEMBERS", prefix + "blocked"})
	}
	if len(commands) == 0 {
		return reading
	}
	replies, err := redis.replies(ctx, commands)
	if err != nil {
		reading.Err = err
		return reading
	}
	for i, key := range keys {
		reading.Groups[key] = scoredMembers(replies[i])
	}
	for i := range ordered {
		reading.DeadLettered = append(reading.DeadLettered, setMembers(replies[len(keys)+2*i])...)
		reading.Blocked = append(reading.Blocked, setMembers(replies[len(keys)+2*i+1])...)
	}
	return reading
}

// scoredMembers pairs a WITHSCORES reply's alternating member and score lines.
func scoredMembers(lines []string) map[string]float64 {
	members := map[string]float64{}
	for i := 0; i+1 < len(lines); i += 2 {
		score, err := strconv.ParseFloat(replyValue(lines[i+1]), 64)
		if err == nil {
			members[replyValue(lines[i])] = score
		}
	}
	return members
}

func setMembers(lines []string) []string {
	var members []string
	for _, line := range lines {
		if value := replyValue(line); value != "" && !strings.HasPrefix(value, "(empty") {
			members = append(members, value)
		}
	}
	return members
}

// groupID is the group-queue's id inside "<prefix>gq:group:<id>:jobs".
func groupID(key string) string {
	from := strings.Index(key, ":gq:group:")
	if from < 0 {
		return key
	}
	return strings.TrimSuffix(key[from+len(":gq:group:"):], ":jobs")
}

// jobKind is a group id without its tenant and aggregate, as QueueByKind names kinds.
func jobKind(id string) string {
	parts := strings.Split(id, "/")
	if len(parts) < 3 {
		return id
	}
	return strings.Join(parts[1:len(parts)-1], "/")
}

// noteQueuedAtCut reads main's queued jobs once its worker is paused (the cut).
func (cell *run) noteQueuedAtCut(ctx context.Context) error {
	cell.queuedAtCut = readQueuedJobs(ctx, redisCLI(cell.stores.RedisPort))
	if cell.queuedAtCut.Err != nil {
		return fmt.Errorf("queued jobs at the cut: %w", cell.queuedAtCut.Err)
	}
	kinds := kindCounts(cell.queuedAtCut, nil)
	cell.report.Notes = append(cell.report.Notes, fmt.Sprintf("queued-jobs-v1: main's jobs at the cut by kind: %v", kinds))
	return nil
}

// kindCounts counts the cut's jobs by kind; with after, only those still waiting in their group.
func kindCounts(cut queuedJobs, keep func(key, job string) bool) map[string]int {
	counts := map[string]int{}
	for key, jobs := range cut.Groups {
		for job := range jobs {
			if keep == nil || keep(key, job) {
				counts[jobKind(groupID(key))]++
			}
		}
	}
	return counts
}

// queuedJobsVerdict (Q1) reads the queue once more after settle and judges main's jobs from the cut.
func (cell *run) queuedJobsVerdict(ctx context.Context) []Verdict {
	if !cell.overlay(OverlayQueuedJobs) {
		return nil
	}
	return []Verdict{judgeQueuedJobs(cell.queuedAtCut, readQueuedJobs(ctx, redisCLI(cell.stores.RedisPort)))}
}

// judgeQueuedJobs: a cut job still in its group and already due is stranded; one due later waits by design;
// any cut group dead-lettered or blocked fails, and so does a cut with no jobs (nothing was proved).
func judgeQueuedJobs(cut, after queuedJobs) Verdict {
	if err := errors.Join(cut.Err, after.Err); err != nil {
		return Verdict{ID: "Q1", Name: invariantNames["Q1"], Result: "inconclusive", Detail: "queue unread: " + err.Error()}
	}
	stranded := kindCounts(cut, func(key, job string) bool {
		due, ok := after.Groups[key][job]
		return ok && due <= float64(after.ReadAtMs)
	})
	later := kindCounts(cut, func(key, job string) bool {
		due, ok := after.Groups[key][job]
		return ok && due > float64(after.ReadAtMs)
	})
	cutGroups := map[string]bool{}
	for key := range cut.Groups {
		cutGroups[groupID(key)] = true
	}
	dead, blocked := inCut(after.DeadLettered, cutGroups), inCut(after.Blocked, cutGroups)
	total := 0
	for _, count := range kindCounts(cut, nil) {
		total += count
	}
	return verdict("Q1", total > 0 && len(stranded) == 0 && len(dead) == 0 && len(blocked) == 0, fmt.Sprintf(
		"%d jobs main queued at the cut, by kind %v; still due in their group after settle: %v; waiting until later (by design): %v; dead-lettered groups: %v; blocked groups: %v",
		total, kindCounts(cut, nil), stranded, later, dead, blocked))
}

func inCut(groups []string, cut map[string]bool) []string {
	var hit []string
	for _, group := range groups {
		if cut[group] {
			hit = append(hit, group)
		}
	}
	slices.Sort(hit)
	return hit
}
