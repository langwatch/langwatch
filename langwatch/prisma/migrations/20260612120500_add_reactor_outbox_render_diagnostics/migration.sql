-- Template render-health diagnostics on the dispatched outbox row
-- (ADR-028 / ADR-029). `renderTriggerEmail` / `renderTriggerSlack` already
-- compute `missingVariables` (the variables a custom template referenced but
-- the render context did not supply); the dispatcher previously dropped them.
-- This column persists them per dispatch — currently shaped as
-- `{ "missingVariables": string[] }` — so the operator surface can show
-- "N missing variables". NULL on a clean render and on dispatches that never
-- rendered a custom template.

-- +goose StatementBegin
ALTER TABLE "ReactorOutbox" ADD COLUMN "renderDiagnostics" JSONB;
-- +goose StatementEnd

-- To roll back, uncomment and run manually:
-- ALTER TABLE "ReactorOutbox" DROP COLUMN "renderDiagnostics";
