-- CreateIndex: the 30-day retention prune deletes by firedAt alone, and
-- attempt grouping reads one batch's rows by (endpointId, dispatchId).
CREATE INDEX "WebhookEndpointDelivery_firedAt_idx" ON "WebhookEndpointDelivery"("firedAt");

CREATE INDEX "WebhookEndpointDelivery_endpointId_dispatchId_idx" ON "WebhookEndpointDelivery"("endpointId", "dispatchId");

-- Down (manual):
--   DROP INDEX "WebhookEndpointDelivery_endpointId_dispatchId_idx";
--   DROP INDEX "WebhookEndpointDelivery_firedAt_idx";
