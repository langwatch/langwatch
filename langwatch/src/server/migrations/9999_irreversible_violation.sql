-- Smoke-test for issue #3754 — DO NOT MERGE.
-- Expect path_instructions on `**/migrations/**/*.{sql,ts,go}` to flag this
-- migration: no `Down` step and no `IRREVERSIBLE:` justification comment.

CREATE TABLE smoke_test_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL
);
