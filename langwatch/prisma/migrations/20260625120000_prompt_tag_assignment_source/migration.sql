-- Issue #5104: capture the event that produced a prompt-tag assignment so
-- promotions triggered by the pairwise/select_best evaluator carry an audit
-- trail back to the eval that produced the decision.
-- Additive only: new nullable JSONB column so existing rows stay valid.

-- AlterTable
ALTER TABLE "PromptTagAssignment" ADD COLUMN "source" JSONB;
