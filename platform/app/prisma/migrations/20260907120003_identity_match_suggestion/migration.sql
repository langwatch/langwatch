-- Match candidates the suggestion job computed, waiting on a human (ADR-128 §12).
--
-- One table, and the reason it is a table rather than a computation is
-- measured. Fuzzy name matching is quadratic and there is no database route to
-- it here: the repo has no pg_trgm and no edit-distance library, so the scoring
-- runs in our own Node process. At the ADR's own example size - 2,000 discovered
-- people against 500 accounts, so 1,000,000 pairs - plain edit distance measured
-- 2.9 seconds of blocked event loop. Computing that when the review screen asks
-- would spend it per page load, uncached, stalling every other request on the
-- instance. A stored row also makes a pending count answerable without paying
-- for the whole sweep, which a compute-at-read design cannot do at any price.
--
-- Written only by the background job. Read by the review surface, which never
-- scores anything itself. Confirming a row opens an "IdentityMatch" and deletes
-- the suggestion.
--
-- Suspension is NOT here. It lives on "DiscoveredPerson", because a halt on
-- automatic linking that the next recompute clears is not a halt.

CREATE TABLE "IdentityMatchSuggestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "discoveredPersonId" TEXT NOT NULL,
    -- Not nullable: a suggestion with no candidate is not a suggestion.
    "userId" TEXT NOT NULL,
    -- Similarity of the two name texts after the prefilter, in [0, 1]. A display
    -- hint and an ordering key - never a threshold anything auto-links on.
    "score" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityMatchSuggestion_pkey" PRIMARY KEY ("id")
);

-- One candidate pair, once. The job rewrites an organization's rows wholesale
-- on each pass, and this is what makes a concurrent second pass idempotent
-- rather than duplicating every candidate it re-derives.
CREATE UNIQUE INDEX "IdentityMatchSuggestion_organizationId_personId_userId_key" ON "IdentityMatchSuggestion"("organizationId", "discoveredPersonId", "userId");

-- The review surface reads one organization's candidates, strongest first.
CREATE INDEX "IdentityMatchSuggestion_organizationId_score_idx" ON "IdentityMatchSuggestion"("organizationId", "score");

-- A score outside [0, 1] is not a similarity, and an ordering built on one
-- silently sorts a bug to the top of the review queue. Rejected in the database
-- rather than trusted from the job, because the job is not the only thing that
-- will ever write here.
ALTER TABLE "IdentityMatchSuggestion" ADD CONSTRAINT "IdentityMatchSuggestion_score_range_check"
    CHECK ("score" >= 0 AND "score" <= 1);

-- Reversible, unlike the erasure tables next door: these rows are derived, and
-- the job rebuilds every one of them on its next pass. Nothing is lost but the
-- pending review queue.
-- To roll back, uncomment and run manually:
--   DROP TABLE "IdentityMatchSuggestion";
