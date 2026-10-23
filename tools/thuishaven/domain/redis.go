package domain

import "strings"

// RedisService is the routed name for a stack's Redis: it always resolves
// (redis.<slug>.langwatch.localhost), pointing at the one shared managed
// server. Redis needs no per-slug database creation — RedisDBForSlug already
// partitions worktrees by DB index on the one server — so unlike ClickHouse
// and Postgres there is no per-worktree "database" here, just the shared
// server's existence being ensured.
const RedisService = "redis"

// DefaultRedisFormula is the brew formula haven installs on a machine with no
// Redis at all. Valkey is a drop-in for Redis; any redis or valkey already
// running is reused as-is, same detect-don't-fight philosophy as Postgres.
const DefaultRedisFormula = ValkeyFormula

// ValkeyFormula and RedisFormula are the two brew formulae haven drives as
// the shared Redis. Homebrew marks them as conflicting, so one is linked at a
// time, though both can be installed.
const (
	ValkeyFormula = "valkey"
	RedisFormula  = "redis"
)

// RedisFormulas lists the formulae haven drives as the shared Redis, in
// preference order: Valkey first, Redis still fully supported.
var RedisFormulas = []string{ValkeyFormula, RedisFormula}

// RedisCLIs are the clients haven talks to the shared server with, preferred
// first. Either speaks to either server; Homebrew's valkey links redis-cli
// too, but a machine with only valkey-cli on PATH still works.
var RedisCLIs = []string{"valkey-cli", "redis-cli"}

// ChooseRedisFormula picks the formula haven starts when nothing answers on
// the Redis port: the one brew already reports as started, else the
// preferred one that is installed, else the default to `brew install`. A
// machine with only Redis keeps Redis.
func ChooseRedisFormula(installed map[string]bool, started string) string {
	if started != "" {
		return started
	}
	for _, formula := range RedisFormulas {
		if installed[formula] {
			return formula
		}
	}
	return DefaultRedisFormula
}

// RedisServerName names the server from its INFO fields: "valkey 9.1.2" or
// "redis 8.2.1". Valkey also reports a redis_version for compatibility, so
// its own server_name is checked first. "" when INFO carried neither.
func RedisServerName(info map[string]string) string {
	if info["server_name"] == ValkeyFormula && info["valkey_version"] != "" {
		return ValkeyFormula + " " + info["valkey_version"]
	}
	if v := info["redis_version"]; v != "" {
		return RedisFormula + " " + v
	}
	return ""
}

// StartedRedisFormula reads `brew services list` output and names the redis
// or valkey service brew reports as started, or "" when neither is.
func StartedRedisFormula(servicesList string) string {
	for _, line := range strings.Split(servicesList, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || fields[1] != "started" {
			continue
		}
		for _, formula := range RedisFormulas {
			if fields[0] == formula {
				return formula
			}
		}
	}
	return ""
}

// DefaultRedisPort is Redis's conventional port and what the brew formula
// binds by default.
const DefaultRedisPort = 6379

// DefaultRedisMaxMemoryMB is the maxmemory ceiling haven applies to the
// managed Redis. Local queues fit comfortably; without a ceiling a leaky dev
// stack grows Redis until the laptop pages. At the ceiling writes fail loudly
// (the default noeviction policy — evicting BullMQ keys would corrupt queues),
// which is the point: a runaway shows up as an error, not as a slow machine.
// HAVEN_REDIS_MAXMEMORY_MB tunes it; 0 disables the cap.
const DefaultRedisMaxMemoryMB = 512
