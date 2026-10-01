Feature: An API key's check is shared through Redis for five seconds, and a revoke ends it at once
  # Two tiers (Alex, 2026-10-01): every pod shares one answer per key in Redis, held for five
  # seconds, and Postgres is the truth. A revoke sets revokedAt and leaves a refusal in the held
  # answer that no late fill can overwrite; a change deletes it. Nothing is broadcast between pods.

  Rule: an answer is held in Redis for five seconds and never outlives a revoke

    @unit
    Scenario: Repeated calls with one key read Postgres once
      Given a valid key
      When two pods make ten calls with it within five seconds
      Then its row and its grants are read once

    @unit
    Scenario: Redis is asked before Postgres
      Given another pod has already checked a key
      When the key is presented again
      Then the answer comes from Redis and Postgres is not read

    @unit
    Scenario: A revoked key is refused on another pod's next request
      Given a key whose answer is held
      When one pod revokes the key
      Then the next request on the other pod is refused, with no time passing

    @unit
    Scenario: A held answer lapses after five seconds
      Given a key whose answer is held
      When five seconds pass
      Then the next request reads Postgres again

    @unit
    Scenario: A wrong secret is refused while the right one is held
      Given a valid key whose answer is held
      When a caller presents the same key id with another secret
      Then that caller is refused

    @unit
    Scenario: An unknown token is held as unknown for two seconds, then checked again
      Given a token that matches no key
      When it is presented on two pods and again after two seconds
      Then Postgres is asked once for the first two and again after two seconds

    @unit
    Scenario: A failed check is never held
      Given Postgres fails while a key is checked
      When the key is presented again
      Then Postgres is asked again and the true answer is returned

    @unit
    Scenario: A key past its expiry is refused even while held
      Given a key that expires in two seconds and whose answer is held
      When three seconds pass
      Then it is refused

    @unit
    Scenario: Two keys never share a held answer
      Given two keys of different organizations are both held
      Then each call resolves its own organization

    @unit
    Scenario: A held answer carries no secret
      Given a key whose answer is held
      Then the held value contains neither the token, its secret nor the stored hash

    @unit
    Scenario: A legacy project key's answer is held for five seconds
      Given a legacy project key checked on one pod
      When another pod checks it within five seconds
      Then the project is asked once

    @unit
    Scenario: An unattended run key is still known as one when its answer is held
      Given an unowned workflow run key whose answer is held
      When another pod resolves it from Redis
      Then it still resolves as an unattended run key

    @unit
    Scenario: Concurrent checks of one token on one pod read Postgres once
      Given a valid key whose answer is not held
      When one pod checks it three times at once
      Then Postgres is read once and every check is answered

    @unit
    Scenario: A revoke's refusal beats a late fill from an earlier read
      Given a check that read the key from Postgres before it was revoked
      When that check fills Redis after the revoke
      Then the refusal stays and every pod refuses the key

    @unit
    Scenario: A revoke's cascade refuses each child key on every pod at once
      Given a key minted under a login key, whose answer is held
      When one pod revokes the login key
      Then the next request with the child key on the other pod is refused, with no time passing

    @unit
    Scenario: A changed key is read afresh on another pod's next request
      Given a key whose answer is held on both pods
      When one pod renames it
      Then the other pod's next request reads Postgres and sees the new name

    @unit
    Scenario: With Redis down, Postgres answers and a revoked key is never valid
      Given Redis refuses every read and write
      When a live key and a revoked key are checked
      Then the live key passes and the revoked key is refused, both answered by Postgres

    @unit
    Scenario: A revoked legacy key's column value is refused before any lookup
      Given a token that begins with the revoked legacy value's prefix
      When it is presented
      Then it is refused without asking Redis or the project

    @unit
    Scenario: A fill never outlives a refusal written after its read began
      Given a check whose Postgres read began before a revoke
      When the read finishes six seconds later
      Then nothing is held and another pod refuses the key

    @unit
    Scenario: A held project from another organization is still refused
      Given a key whose answer holds a project of another organization
      When callers on two pods name that project
      Then both are refused and the project is read once

    @unit
    Scenario: A held project outside the key's bindings is still refused
      Given a key whose answer holds a project of its organization it is not bound to
      When callers on two pods name that project
      Then both are refused and the project is read once
