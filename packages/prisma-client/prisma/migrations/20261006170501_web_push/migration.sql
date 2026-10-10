-- Web Push for Langy notifications, owned by notification.
--
-- WebPushSubscription holds one row per browser a person subscribed: the push
-- service endpoint and the browser's keys. WebPushVapidKey holds this
-- installation's one VAPID key pair, generated on first use, the private key
-- encrypted with the process encryption key.
--
-- Spec: modules/notification/specs/web-push.feature
--
-- IRREVERSIBLE: there is no down migration.
--
-- The schema part reverses with the statements below, run by hand:
--
--   DROP TABLE "WebPushSubscription";
--   DROP TABLE "WebPushVapidKey";
--
-- The data part does not: dropping the subscriptions stops every push until
-- each browser subscribes again, and dropping the key pair makes every
-- existing browser subscription unusable.

CREATE TABLE "WebPushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),

    CONSTRAINT "WebPushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebPushSubscription_endpoint_key" ON "WebPushSubscription"("endpoint");

CREATE INDEX "WebPushSubscription_userId_idx" ON "WebPushSubscription"("userId");

CREATE TABLE "WebPushVapidKey" (
    "id" TEXT NOT NULL DEFAULT 'self',
    "publicKey" TEXT NOT NULL,
    "privateKeyEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebPushVapidKey_pkey" PRIMARY KEY ("id")
);
