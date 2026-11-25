-- ADR-116 §6: the address lock.
--
-- Uniqueness of a PROVEN identifier value was a command-time read: the guard
-- asked whether anybody else held the address and then stated the fact. Two
-- verifications of the same address, in either population, can both pass that
-- read before either write lands - and the loser's verification is then in
-- the event log forever, with its single-use proof already burned.
--
-- This table is the lock that decides it. A claim is taken atomically, keyed
-- on the normalized value, BEFORE the proof is consumed and BEFORE any fact is
-- appended, so the loser is refused synchronously with `identity_email_in_use`
-- and nothing about the losing attempt is recorded.
--
-- It is a LOCK, not a truth table: `Identifier` remains the record of who
-- holds which sign-in method. The fold releases a claim when its identifier
-- stops holding the value, and the identity sweep reaps a claim whose fact
-- never landed.
--
-- Additive and dark: the write gate ships closed, so nothing claims a row here
-- until an operator enrolls somebody.
--
-- To roll back, uncomment and run manually. Dropping the table loses only
-- in-flight locks.
-- DROP TABLE "IdentifierReservation";

-- CreateTable
CREATE TABLE "IdentifierReservation" (
    "normalizedValue" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identifierId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- The primary key IS the constraint: one holder per normalized address.
    CONSTRAINT "IdentifierReservation_pkey" PRIMARY KEY ("normalizedValue")
);

-- Scopes the release the fold performs for one user.
-- CreateIndex
CREATE INDEX "IdentifierReservation_userId_idx" ON "IdentifierReservation"("userId");

-- Reaches the claim an identifier holds, for the release and the sweep.
-- CreateIndex
CREATE INDEX "IdentifierReservation_identifierId_idx" ON "IdentifierReservation"("identifierId");
