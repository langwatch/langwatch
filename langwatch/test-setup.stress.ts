import dotenv from "dotenv";

dotenv.config({ path: ".env" });

// Stress tests use REAL infrastructure (Redis, ClickHouse, Postgres).
// Do NOT call initializeEventSourcingForTesting() here — that forces
// in-memory stores and nothing reaches ClickHouse/Redis.
