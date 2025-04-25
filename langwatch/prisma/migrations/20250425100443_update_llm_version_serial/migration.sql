-- AlterTable
ALTER TABLE "LlmPromptConfigVersion" ALTER COLUMN "version" DROP DEFAULT;
DROP SEQUENCE "LlmPromptConfigVersion_version_seq";