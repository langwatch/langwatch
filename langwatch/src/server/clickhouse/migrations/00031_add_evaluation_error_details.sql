-- Add ErrorDetails column to evaluation_runs for storing extended error context (e.g. stack traces)
ALTER TABLE evaluation_runs ADD COLUMN IF NOT EXISTS ErrorDetails Nullable(String) AFTER Error;
