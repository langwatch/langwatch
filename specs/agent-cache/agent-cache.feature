Feature: The agent cache
  As a code agent that does the same work on every row of a run
  I want a place to keep what I produced
  So that the rows that follow read it instead of repeating the work

  # WHY THIS EXISTS
  #
  # Rows are isolated. A code agent that logs in, or pays for a handle, does
  # that once per row, and a run of two hundred rows logs in two hundred
  # times. The agent cache gives the agent one place to put the result.
  #
  # It is not the project secret store, and the difference is the point:
  #   - the secret store holds what an operator typed, and never reads a value
  #     back; the cache holds what the agent produced, and reading it back is
  #     the whole feature;
  #   - a cache entry expires by itself, so nothing has to clean up after a
  #     run that stopped halfway.
  #
  # Both grains are new. Every route asks for agentCache:manage, the write
  # grain, and not for agentCache:view: a caller that can overwrite an entry
  # can already choose what the next read answers, so a read-only tier would
  # divide nothing. ADMIN and MEMBER hold both; VIEWER and EXTERNAL hold
  # neither, because a cache entry is agent-written state a reader has no call
  # to see.
  #
  # There is no listing route. Names come from the agent code that wrote them.
  #
  # ACCEPTED: an entry belongs to the project, not to one run. A later run
  # reads what an earlier run wrote under the same name, which is what lets a
  # second run reuse a session instead of logging in again. The same applies
  # to writes and deletes: two concurrent runs that write the same entry name
  # see last-write-wins, and either can delete an entry the other run reads.
  # That is the documented first-wave race applied across runs, and neither
  # outcome is wrong: both sessions are valid (both runs logged in), and the
  # surviving one wins. Scoping entries per run would end reuse between runs
  # and fence off nothing: every code sandbox in a project already receives
  # every project secret in its payload, and the code that writes the entry
  # is authored by someone who holds project access. Docs caution agent
  # authors to pick collision-resistant entry names when a project runs
  # several distinct agents concurrently.
  #
  # A caller that needs one row rather than all of them to do the work takes
  # the name with a claim, which writes only when the name is free. That is
  # the answer to rows that start together, and it stays opt-in: the plain
  # write is still last-write-wins.
  #
  # ACCEPTED: a legacy sk-lw- project key reaches these routes, as it reaches
  # the rest of the project surface. Such a key already holds full project
  # access, and the cache holds only state an agent wrote, so the passthrough
  # grants nothing a legacy key did not already have.
  #
  # ACCEPTED: a read writes no audit event. The store holds transient,
  # agent-written state with a lifetime measured in minutes, so an audit trail
  # over it would record the agent's own bookkeeping and nothing a person did.

  Background:
    Given a project with an API key that can manage the agent cache

  Rule: An entry is written by name and read back by name

    @integration
    Scenario: A stored entry is read back by its name
      Given the caller stores a value under ACME_SESSION
      When the caller reads ACME_SESSION
      Then the response carries the value that was stored

    @integration
    Scenario: A second write replaces the entry
      Given the project holds an entry named ACME_SESSION
      When the caller stores a new value under the same name
      Then a read answers the newer value

    @integration
    Scenario: An entry stops answering once its lifetime passes
      Given the caller stores a value under ACME_SESSION with a lifetime of five seconds
      When the caller reads ACME_SESSION after that lifetime has passed
      Then the request is refused with the cache_entry_not_found code

    @integration
    Scenario: A name the project does not hold is refused as not found
      Given the project holds no entry named ACME_SESSION
      When the caller reads ACME_SESSION
      Then the request is refused with the cache_entry_not_found code

    @integration
    Scenario: Removing an entry the project does not hold succeeds
      Given the project holds no entry named ACME_SESSION
      When the caller removes ACME_SESSION
      Then the request succeeds
      # A caller can clear an entry without reading it first.

    # One code answers every empty read, including a value written before the
    # instance's encryption key changed. The caller produces the value again
    # in each case, so telling the cases apart would add words without adding
    # a choice. The refusal is logged with the project and the name, never
    # with the value.
    @unit
    Scenario: An entry the platform can no longer read answers as a miss
      Given a stored entry whose value cannot be decrypted
      When the caller reads that entry
      Then the request is refused with the cache_entry_not_found code
      And no log line carries the stored value

  Rule: The accepted bounds are stated at the route

    @integration
    Scenario: A value past the size limit is refused
      When the caller stores a value larger than 32 KB
      Then the request is refused as a bad request

    @integration
    Scenario: A name outside the accepted shape is refused
      When the caller reads a name that is not UPPER_SNAKE_CASE
      Then the request is refused as a bad request

    @integration
    Scenario: A lifetime outside the accepted range is refused
      When the caller stores a value with a lifetime under five seconds
      Then the request is refused as a bad request

  Rule: Only a caller that can manage the cache reaches it

    @integration
    Scenario: A caller without the manage grain is refused
      Given a caller that holds neither agentCache grain
      When the caller reads or writes an entry
      Then the request is refused as forbidden

    @integration
    Scenario: A request without an API key is refused
      Given a request that carries no API key
      When the caller reads an entry
      Then the request is refused as unauthenticated

    @integration
    Scenario: A legacy project key reaches the agent cache
      Given a request that carries the legacy project API key
      When the caller stores an entry and reads it back
      Then the request succeeds

  Rule: A caller can take a name only if the project does not hold it

    # Rows that start together all read an empty cache and all do the work
    # the entry was meant to save. A claim is how one of them takes the name
    # first: the write happens only if the name is free, and the answer says
    # whether this caller is the one that took it. Losing is not a refusal,
    # so agent code reads a boolean rather than catching an exception.

    @integration
    Scenario: A claim on a free name is taken
      Given the project holds no entry named ACME_SESSION
      When the caller claims ACME_SESSION
      Then the response says the name was taken
      And a read answers the claimed value

    @integration
    Scenario: A claim on a held name leaves the held value alone
      Given the project holds an entry named ACME_SESSION
      When the caller claims ACME_SESSION with a different value
      Then the response says the name was not taken
      And a read still answers the value that was already there

    @integration
    Scenario: A name is free again once its lifetime passes
      Given the caller claims ACME_SESSION with a lifetime of five seconds
      When the caller claims ACME_SESSION after that lifetime has passed
      Then the response says the name was taken

    @integration
    Scenario: Only one of several claims sent at once takes the name
      Given the project holds no entry named ACME_SESSION
      When several callers claim ACME_SESSION at the same moment
      Then exactly one response says the name was taken
      And a read answers the value that caller sent

    # A read and a write degrade to a per-process answer when the store
    # cannot answer, and the worst that costs is a stale read. A claim that
    # degraded the same way would name one winner per process, which is the
    # one outcome it exists to prevent.
    @unit
    Scenario: A claim the store cannot answer raises rather than naming a winner
      Given a store that cannot answer
      When the caller claims a name
      Then the call is refused
      And the caller is never told it took the name

    @unit
    Scenario: The SDK answers a lost claim with false
      Given the project already holds an entry named ACME_SESSION
      When the agent claims ACME_SESSION
      Then the agent is given false, and no exception is raised

  Rule: A run reaches the cache with a key minted for that run

    # The key belongs to no user, is bound to one project, holds the manage
    # grain and nothing else, and expires after twelve hours. It is never the
    # project key. A run that cannot mint one still runs: every row does its
    # own work, which is what a run without the cache does anyway.
    #
    # The manage grain alone, because it is what all three routes ask for.
    # Adding agentCache:view would reach no route today, and would hand every
    # sandbox in the product whatever a later view-guarded route answers.

    @integration
    Scenario: The sandbox key reaches the agent cache
      Given a key minted for one run of this project
      When the run stores an entry and reads it back
      Then the request succeeds

    @integration
    Scenario: The sandbox key reaches nothing else
      Given a key minted for one run of this project
      When the run calls another route in the same project
      Then the request is refused as forbidden

    @unit
    Scenario: A run whose key could not be minted still runs
      Given the platform cannot mint a sandbox key
      When the run starts
      Then the run executes with no cache credential
      And the failure is warned about, not raised

    @unit
    Scenario: A key whose lifetime has passed is retired
      Given a sandbox key whose lifetime has passed
      When the hourly sweep runs
      Then the key is revoked
      And a key a customer created is left untouched

  Rule: The SDK reads and writes the cache from agent code

    @unit
    Scenario: The SDK answers a miss with the caller's default
      Given the project holds no entry named ACME_SESSION
      When the agent reads ACME_SESSION with a default
      Then the agent is given the default, and no exception is raised

    @unit
    Scenario: The SDK carries the lifetime the caller named
      When the agent stores a value with a lifetime
      Then the write carries that lifetime

    @unit
    Scenario: The SDK raises on a refusal that is not a miss
      Given the platform answers a server error
      When the agent reads an entry
      Then the agent is told the call was refused

    @unit
    Scenario: No message from the SDK quotes a cached value
      Given the platform refuses a write
      When the agent reads the exception
      Then nothing in it quotes the value the agent sent
      # A run shows what it printed, and an exception text is printed often.
