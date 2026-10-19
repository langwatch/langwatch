package cell

import (
	"bytes"
	"context"
	"fmt"
	"maps"
	"os/exec"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	redisBatch   = 200 // commands per redis-cli call, so Redis is never held for more than a few ms
	redisDivider = "--end--"
)

var replyIndex = regexp.MustCompile(`^\d+\) `)

// scanKeys lists keys with SCAN through redis-cli --scan, which never blocks Redis.
func scanKeys(ctx context.Context, port, pattern string) ([]string, error) {
	out, err := exec.CommandContext(ctx, "redis-cli", "-p", port, "--scan", "--pattern", pattern, "--count", "1000").Output() // #nosec G204 -- fixed arguments.
	if err != nil {
		return nil, fmt.Errorf("redis-cli --scan: %w", err)
	}
	var names []string
	for _, name := range strings.Split(string(out), "\n") {
		if name != "" {
			names = append(names, name)
		}
	}
	return names, nil
}

// redisReplies runs each command in batches through one redis-cli reading stdin and answers each
// command's reply lines (--no-raw, so every value is one quoted line).
func redisReplies(ctx context.Context, port string, commands [][]string) ([][]string, error) {
	var replies [][]string
	for from := 0; from < len(commands); from += redisBatch {
		batch := commands[from:min(from+redisBatch, len(commands))]
		cmd := exec.CommandContext(ctx, "redis-cli", "-p", port, "--no-raw") // #nosec G204 -- fixed arguments.
		cmd.Stdin = strings.NewReader(batchInput(batch))
		out, err := cmd.Output()
		if err != nil {
			return nil, fmt.Errorf("redis-cli: %w", err)
		}
		answers := splitReplies(string(out))
		if len(answers) != len(batch) {
			return nil, fmt.Errorf("redis-cli answered %d of %d commands", len(answers), len(batch))
		}
		replies = append(replies, answers...)
	}
	return replies, nil
}

func batchInput(batch [][]string) string {
	var input strings.Builder
	for _, command := range batch {
		quoted := make([]string, len(command))
		for i, word := range command {
			quoted[i] = strconv.Quote(word)
		}
		input.WriteString(strings.Join(quoted, " ") + "\nECHO " + redisDivider + "\n")
	}
	return input.String()
}

// splitReplies cuts redis-cli output at each divider echo into one line list per command.
func splitReplies(out string) [][]string {
	var replies [][]string
	var lines []string
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == strconv.Quote(redisDivider) {
			replies, lines = append(replies, lines), nil
		} else if line != "" {
			lines = append(lines, line)
		}
	}
	return replies
}

// replyValue is one --no-raw line's value: its "N) " index and quotes dropped, a string unescaped.
func replyValue(line string) string {
	line = replyIndex.ReplaceAllString(strings.TrimSpace(line), "")
	line = strings.TrimPrefix(line, "(integer) ")
	if unquoted, err := strconv.Unquote(line); err == nil {
		return unquoted
	}
	return line
}

func replyInt(lines []string) int {
	if len(lines) == 0 {
		return 0
	}
	count, _ := strconv.Atoi(replyValue(lines[0]))
	return count
}

// The group queue's own bookkeeping (packages/group-queue: scripts.ts, drainAudit.ts): queues
// register in one set, and each keeps a waiting-job counter beside its ready-groups index.
const (
	groupQueueRegistry = "{gq-registry}:names"
	readySuffix        = ":gq:ready"
)

// redisReads is the two reads the depth needs; redisCLI is the cell's, a fake stands in for tests.
type redisReads interface {
	scan(ctx context.Context, pattern string) ([]string, error)
	replies(ctx context.Context, commands [][]string) ([][]string, error)
}

type redisCLI string // the port

func (port redisCLI) scan(ctx context.Context, pattern string) ([]string, error) {
	return scanKeys(ctx, string(port), pattern)
}

func (port redisCLI) replies(ctx context.Context, commands [][]string) ([][]string, error) {
	return redisReplies(ctx, string(port), commands)
}

// QueueCount is one group queue's waiting work, read as the product's drain audit reads it.
type QueueCount struct {
	Name    string `json:"name"`
	Pending int    `json:"pending"` // max(stats:total-pending, ready groups): drainAudit.countPending
	Ready   int    `json:"readyGroups"`
	Blocked int    `json:"blockedGroups"`
}

// groupQueueNames is the registry's queues; only an empty registry pays for a SCAN of ready indexes.
func groupQueueNames(ctx context.Context, redis redisReads) ([]string, error) {
	replies, err := redis.replies(ctx, [][]string{{"SMEMBERS", groupQueueRegistry}})
	if err != nil {
		return nil, err
	}
	names := map[string]bool{}
	for _, line := range replies[0] {
		if name := replyValue(line); name != "" && !strings.HasPrefix(name, "(empty") {
			names[name] = true
		}
	}
	if len(names) == 0 {
		keys, err := redis.scan(ctx, "*"+readySuffix)
		if err != nil {
			return nil, err
		}
		for _, key := range keys {
			names[strings.TrimSuffix(key, readySuffix)] = true
		}
	}
	return slices.Sorted(maps.Keys(names)), nil
}

// queueCounts reads each group queue's counter, ready index and blocked set: four reads a queue, no SCAN.
func queueCounts(ctx context.Context, redis redisReads) ([]QueueCount, error) {
	names, err := groupQueueNames(ctx, redis)
	if err != nil || len(names) == 0 {
		return nil, err
	}
	commands := make([][]string, 0, 3*len(names))
	for _, name := range names {
		prefix := name + ":gq:"
		commands = append(commands, []string{"GET", prefix + "stats:total-pending"}, []string{"ZCARD", prefix + "ready"}, []string{"SCARD", prefix + "blocked"})
	}
	replies, err := redis.replies(ctx, commands)
	if err != nil {
		return nil, err
	}
	counts := make([]QueueCount, len(names))
	for i, name := range names {
		ready := replyInt(replies[3*i+1])
		counts[i] = QueueCount{Name: name, Pending: max(replyInt(replies[3*i]), ready), Ready: ready, Blocked: replyInt(replies[3*i+2])}
	}
	return counts, nil
}

// QueueDepth is every group queue's waiting jobs, from the counters the product keeps.
func QueueDepth(ctx context.Context, port string) (int, error) {
	counts, err := queueCounts(ctx, redisCLI(port))
	return totalPending(counts), err
}

func totalPending(counts []QueueCount) int {
	total := 0
	for _, count := range counts {
		total += count.Pending
	}
	return total
}

// QueueNotDue counts group-queue jobs scheduled later than now (zset score = due ms), such as the trace
// pipeline's five-minute deferred origin jobs: waiting by design, not a backlog the worker failed to drain.
func QueueNotDue(ctx context.Context, port string) (int, error) {
	names, err := scanKeys(ctx, port, "*:gq:group:*:jobs")
	if err != nil || len(names) == 0 {
		return 0, err
	}
	after := "(" + strconv.FormatInt(time.Now().UnixMilli(), 10)
	commands := make([][]string, 0, len(names))
	for _, name := range names {
		commands = append(commands, []string{"ZCOUNT", name, after, "+inf"})
	}
	replies, err := redisReplies(ctx, port, commands)
	if err != nil {
		return 0, err
	}
	total := 0
	for _, reply := range replies {
		total += replyInt(reply)
	}
	return total, nil
}

// QueueDueDepth is QueueDepth less the jobs not yet due; the not-due scan runs only above limit.
func QueueDueDepth(ctx context.Context, port string, limit int) (depth, notDue int, err error) {
	if depth, err = QueueDepth(ctx, port); err != nil || depth <= limit {
		return depth, 0, err
	}
	if notDue, err = QueueNotDue(ctx, port); err != nil {
		return depth, 0, err
	}
	return max(depth-notDue, 0), notDue, nil
}

// QueueBreakdown names each queue's counts, so a report reader can judge what the depth counted.
func QueueBreakdown(ctx context.Context, port string) string {
	counts, err := queueCounts(ctx, redisCLI(port))
	if err != nil {
		return "unread: " + err.Error()
	}
	rows := make([]string, 0, len(counts))
	for _, count := range counts {
		rows = append(rows, fmt.Sprintf("%s pending %d, ready groups %d, blocked groups %d", count.Name, count.Pending, count.Ready, count.Blocked))
	}
	return strings.Join(rows, "\n")
}

// QueueByKind groups the group-queue's waiting jobs by job kind (the group key without tenant and
// aggregate): jobs, groups and when the earliest and latest are due, from the zset scores (ms).
func QueueByKind(ctx context.Context, port string) string {
	names, err := scanKeys(ctx, port, "*:gq:group:*:jobs")
	if err != nil {
		return ""
	}
	commands := make([][]string, 0, 3*len(names))
	for _, name := range names {
		commands = append(commands, []string{"ZRANGE", name, "0", "0", "WITHSCORES"}, []string{"ZRANGE", name, "-1", "-1", "WITHSCORES"}, []string{"ZCARD", name})
	}
	replies, err := redisReplies(ctx, port, commands)
	if err != nil {
		return ""
	}
	var out bytes.Buffer
	for i, name := range names {
		first, last := replies[3*i], replies[3*i+1]
		if len(first) == 2 && len(last) == 2 {
			fmt.Fprintf(&out, "%s %d %s %s\n", name, replyInt(replies[3*i+2]), replyValue(first[1]), replyValue(last[1]))
		}
	}
	return groupQueueKinds(out.String(), time.Now().UnixMilli())
}
