-- Automatic sequence actually doesn't make sense for version table, as the sequence is not global but per prompt.
ALTER TABLE "LlmPromptConfigVersion" ALTER COLUMN "version" DROP DEFAULT;
DO $$
BEGIN
    DROP SEQUENCE IF EXISTS "LlmPromptConfigVersion_version_seq";
END $$;