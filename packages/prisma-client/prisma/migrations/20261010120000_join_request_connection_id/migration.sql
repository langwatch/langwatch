-- The connection a single sign-on arrival came in through; null for every other request.
ALTER TABLE "JoinRequest" ADD COLUMN IF NOT EXISTS "connectionId" TEXT;
