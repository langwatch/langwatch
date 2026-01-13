/**
 * Sets safe default environment variables for deja-view.
 * This must be imported before any modules that use @t3-oss/env.
 */

// Suppress all logs by default to keep the TUI clean
process.env.PINO_LOG_LEVEL = process.env.LOG_LEVEL = "error";
process.env.DATABASE_URL = "postgresql://fake:fake@localhost:5432/fake";
process.env.BASE_HOST = "http://localhost:3000";
process.env.NEXTAUTH_SECRET = "deja-view-fake-secret";
process.env.NEXTAUTH_URL = "http://localhost:3000";
process.env.API_TOKEN_JWT_SECRET = "deja-view-fake-jwt-secret";
process.env.ELASTICSEARCH_NODE_URL = "http://localhost:9200";
