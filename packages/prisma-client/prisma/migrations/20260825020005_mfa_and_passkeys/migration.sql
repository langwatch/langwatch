-- Two-step verification and passkeys (D06, D07 - see
-- specs/identity/mfa-and-session-shape.feature and
-- specs/identity/passkeys.feature).
--
-- Entirely additive, and nobody is signed out by it. Every column added to an
-- existing table is nullable or defaulted, so no row is rewritten and no
-- session is invalidated: `Session.identifierId` is NULL and `Session.amr` is
-- empty on every session that predates this, which is an ordinary value the
-- membership condition reads as "proved nothing", not an error state.
--
-- Both features ship behind env flags that default off (MFA_ENROLLMENT_OPEN,
-- PASSKEYS_ENABLED), so landing this changes nothing anybody can reach. The
-- tables exist and stay empty until a flag is turned on.
--
-- To roll back, uncomment and run manually. Dropping MfaEnrollment loses only
-- fold-written projection state, which a replay rebuilds from the event log;
-- dropping TwoFactor or Passkey loses PROTOCOL state that exists nowhere else
-- and cannot be rebuilt - everybody enrolled would have to set up again.
-- ALTER TABLE "Session" DROP COLUMN "identifierId", DROP COLUMN "amr";
-- ALTER TABLE "User" DROP COLUMN "twoFactorEnabled";
-- ALTER TABLE "Organization" DROP COLUMN "mfaRequired";
-- DROP TABLE "MfaEnrollment";
-- DROP TABLE "Passkey";
-- DROP TABLE "TwoFactor";

-- AlterTable: which sign-in method minted the session, and what it proved.
ALTER TABLE "Session" ADD COLUMN     "identifierId" TEXT,
ADD COLUMN     "amr" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable: the two-factor plugin's own flag. It challenges every sign-in
-- while this is true, which is why a session that never answered a challenge
-- cannot exist for an enabled account.
ALTER TABLE "User" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: the membership condition. Off for every existing organization,
-- so no member is held at a gate on the strength of this migration alone.
ALTER TABLE "Organization" ADD COLUMN     "mfaRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: protocol state owned end to end by the two-factor plugin.
-- `backupCodes` is an encrypted blob rather than hashes, because the plugin
-- decrypts and compares to verify a code somebody types.
CREATE TABLE "TwoFactor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable: protocol state owned end to end by the passkey plugin. The
-- credential lives here; the sign-in METHOD it represents is an Identifier
-- row with provider 'passkey'.
CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "transports" TEXT,
    "aaguid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);

-- CreateTable: the enrollment projection. One row per person, fold-written,
-- never deleted - DISABLED is a tombstone, which is how history survives
-- being turned off. Cursor columns are inline because one row IS one
-- aggregate here. No column can hold a secret or a code:
-- consumedBackupCodeIndexes holds positions.
CREATE TABLE "MfaEnrollment" (
    "userId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "method" TEXT,
    "state" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "disabledVia" TEXT,
    "backupCodeCount" INTEGER NOT NULL DEFAULT 0,
    "consumedBackupCodeIndexes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "projectionVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaEnrollment_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "TwoFactor_userId_idx" ON "TwoFactor"("userId");

-- CreateIndex
CREATE INDEX "TwoFactor_secret_idx" ON "TwoFactor"("secret");

-- CreateIndex
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");

-- CreateIndex
CREATE INDEX "Passkey_credentialID_idx" ON "Passkey"("credentialID");

-- CreateIndex
CREATE INDEX "MfaEnrollment_state_idx" ON "MfaEnrollment"("state");
