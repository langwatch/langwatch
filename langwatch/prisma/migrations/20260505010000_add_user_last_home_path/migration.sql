-- Add User.lastHomePath — user-level pin for the persona-resolver
-- redirect target. NULL = use auto-detection.
--
-- Spec: specs/ai-gateway/governance/persona-home-content.feature

ALTER TABLE "User" ADD COLUMN "lastHomePath" TEXT;
