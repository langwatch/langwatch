package domain

// RedisService is the routed name for a stack's Redis: it always resolves
// (redis.<slug>.langwatch.localhost), pointing at the one shared managed
// server. Redis needs no per-slug database creation — RedisDBForSlug already
// partitions worktrees by DB index on the one server — so unlike ClickHouse
// and Postgres there is no per-worktree "database" here, just the shared
// server's existence being ensured.
const RedisService = "redis"

// DefaultRedisFormula is the brew formula haven starts when redis is not
// already running (any pre-existing redis service is reused as-is, same
// detect-don't-fight philosophy as Postgres).
const DefaultRedisFormula = "redis"

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
