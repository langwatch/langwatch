-- Admin-set governance message shown to end users when the gateway blocks a
-- request for an account-level reason they cannot self-resolve (org gateway
-- spending limit reached, or the org's provider account is exhausted). NULL =
-- unset = the provider's verbatim error is forwarded unchanged (the bug-33
-- transparency default). When set, the gateway swaps only the human-facing
-- message, preserving HTTP status + error type + retry-signalling headers.
ALTER TABLE "Organization" ADD COLUMN "governanceAccountErrorMessage" TEXT;
