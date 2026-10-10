package cell

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// queueExcluded is every completed, failed or bookkeeping key (the gq ready index and stats, known pipelines).
var queueExcluded = regexp.MustCompile(`:completed$|:failed$|:events$|:meta$|:repeat$|:stalled|dedup|lock|known-pipelines|:gq:stats:|:gq:ready$`)

const (
	redisBatch   = 200 // commands per redis-cli call, so Redis is never held for more than a few ms
	redisDivider = "--end--"
)

var (
	replyIndex  = regexp.MustCompile(`^\d+\) `)
	streamEntry = regexp.MustCompile(`^\d+\) 1\) (".*")$`) // an unindented line: a field pair is nested deeper
)

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

type queueKey struct{ name, kind string }

type queueScan struct {
	pattern  string
	filtered bool
}

var (
	allKeys   = queueScan{pattern: "*"}
	queueOnly = queueScan{pattern: "*", filtered: true}
)

// queueKeys scans pattern (queue-shaped keys only), drops the excluded keys when filtered, and types the rest in batches.
func queueKeys(ctx context.Context, port string, scan queueScan) ([]queueKey, error) {
	names, err := scanKeys(ctx, port, scan.pattern)
	if err != nil {
		return nil, err
	}
	var kept []string
	var commands [][]string
	for _, name := range names {
		if !scan.filtered || !queueExcluded.MatchString(name) {
			kept = append(kept, name)
			commands = append(commands, []string{"TYPE", name})
		}
	}
	replies, err := redisReplies(ctx, port, commands)
	if err != nil {
		return nil, err
	}
	var keys []queueKey
	for i, name := range kept {
		if kind := replyValue(strings.Join(replies[i], "")); kind == "zset" || kind == "list" || kind == "stream" {
			keys = append(keys, queueKey{name: name, kind: kind})
		}
	}
	return keys, nil
}

func lengthCommand(key queueKey) []string {
	switch key.kind {
	case "zset":
		return []string{"ZCARD", key.name}
	case "list":
		return []string{"LLEN", key.name}
	case "stream":
		return []string{"XLEN", key.name}
	}
	return []string{"ECHO", "0"} // not a queue
}

// queueLengths is each key's waiting-item count, in keys' order.
func queueLengths(ctx context.Context, port string, keys []queueKey) ([]int, error) {
	commands := make([][]string, len(keys))
	for i, key := range keys {
		commands[i] = lengthCommand(key)
	}
	replies, err := redisReplies(ctx, port, commands)
	lengths := make([]int, len(replies))
	for i, reply := range replies {
		lengths[i] = replyInt(reply)
	}
	return lengths, err
}

// QueueDepth reads the cell's Redis once, with SCAN and batched lengths.
func QueueDepth(ctx context.Context, port string) (int, error) {
	keys, err := queueKeys(ctx, port, queueOnly)
	if err != nil {
		return 0, err
	}
	lengths, err := queueLengths(ctx, port, keys)
	total := 0
	for _, length := range lengths {
		total += length
	}
	return total, err
}

// QueueJobs lists every waiting job as "key member", with the same exclusions as the depth.
func QueueJobs(ctx context.Context, port string) (map[string]struct{}, error) {
	keys, err := queueKeys(ctx, port, queueOnly)
	if err != nil {
		return nil, err
	}
	commands := make([][]string, len(keys))
	for i, key := range keys {
		switch key.kind {
		case "zset":
			commands[i] = []string{"ZRANGE", key.name, "0", "-1"}
		case "list":
			commands[i] = []string{"LRANGE", key.name, "0", "-1"}
		case "stream":
			commands[i] = []string{"XRANGE", key.name, "-", "+"}
		default:
			commands[i] = []string{"ECHO", "0"}
		}
	}
	replies, err := redisReplies(ctx, port, commands)
	if err != nil {
		return nil, err
	}
	jobs := map[string]struct{}{}
	for i, key := range keys {
		addJobs(jobs, key, replies[i])
	}
	return jobs, nil
}

// addJobs names a key's waiting jobs: a list's by position, a stream's by entry id, a set's by member.
func addJobs(jobs map[string]struct{}, key queueKey, lines []string) {
	position := 0
	for _, line := range lines {
		switch key.kind {
		case "stream":
			if match := streamEntry.FindStringSubmatch(line); match != nil {
				jobs[key.name+" "+replyValue(match[1])] = struct{}{}
			}
		case "list":
			position++
			jobs[key.name+" #"+strconv.Itoa(position)+replyValue(line)] = struct{}{}
		default:
			jobs[key.name+" "+replyValue(line)] = struct{}{}
		}
	}
}

// TopQueueKeys names the longest keys, so a report reader can judge what the depth counted.
func TopQueueKeys(ctx context.Context, port string) string {
	keys, err := queueKeys(ctx, port, allKeys)
	if err != nil {
		return ""
	}
	lengths, _ := queueLengths(ctx, port, keys)
	var rows []string
	for i, key := range keys {
		if i < len(lengths) && lengths[i] > 0 {
			rows = append(rows, fmt.Sprintf("%s %s %d", key.name, key.kind, lengths[i]))
		}
	}
	return strings.Join(rows[:min(len(rows), 25)], "\n")
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
