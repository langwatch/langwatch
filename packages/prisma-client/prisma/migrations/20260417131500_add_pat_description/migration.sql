-- Add optional `description` column to PersonalAccessToken.
-- The original PAT migration (20260414222341_add_personal_access_tokens) was
-- edited to include this column after it had already been applied in some
-- environments. This follow-up migration is additive for those databases;
-- environments that re-created the table from the edited migration will
-- simply no-op because the column already exists.

ALTER TABLE "PersonalAccessToken" ADD COLUMN IF NOT EXISTS "description" TEXT;
