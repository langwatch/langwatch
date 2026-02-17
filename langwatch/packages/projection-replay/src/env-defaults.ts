// Skip @t3-oss/env validation entirely — this is a standalone CLI tool,
// not the Next.js app. Pipeline imports trigger env.mjs at module load;
// this flag tells it to skip all validation.
process.env.SKIP_ENV_VALIDATION = "1";

// Suppress runtime logs to keep the TUI clean
process.env.PINO_LOG_LEVEL = process.env.LOG_LEVEL = "error";

// Clear storage urls so they can't leak in from the shell.
process.env.DATABASE_URL = "";
process.env.CLICKHOUSE_URL = "";
process.env.ELASTICSEARCH_NODE_URL = "";
process.env.ELASTICSEARCH_API_KEY = "";
process.env.REDIS_URL = "";
