Feature: A large answer is paged, never cut

  As a coding agent (or any API client) calling the LangWatchQL query door
  I want a way to keep reading when one answer does not fit in a single page
  So that I never silently lose rows and never have to guess how to ask for more

  Issue: #8085.

  Rule: Page through a large result

    @e2e @unimplemented
    Scenario: Page through a large result
      Given a user with an API key with access to a project with a lot of data
      When they run a query whose answer is larger than one page
      Then they get one page and a way to ask for the next

  Rule: A large result is capped, never silently cut

    # The row cap is applied to the statement itself: a statement that names no
    # LIMIT has the default one appended before it runs, so an unbounded answer
    # comes back as one page rather than a stream.
    @unit
    Scenario: A statement with no LIMIT is capped at the row ceiling
      Given a statement that names no LIMIT of its own
      When it is validated
      Then it is flagged for the default row LIMIT to be appended before it runs
      And a statement that already pages with LIMIT or OFFSET is left exactly as written

    # A caller asking for more than one page can have at once is told so before
    # the query runs, with the cap and how to page named on the refusal.
    @unit
    Scenario: A LIMIT above the ceiling is refused before the query runs
      Given a statement whose own LIMIT asks for more than the row ceiling
      When it is validated
      Then it is refused with LIMIT_TOO_HIGH, naming the cap and to page with LIMIT/OFFSET and ORDER BY

    # The cap comes back as a whole page of exactly that many rows, with no
    # truncation flag and no diagnostic: nothing was cut, the answer was bounded.
    @integration
    Scenario: A capped result comes back as one page, never silently cut
      Given a query whose answer is larger than the row ceiling
      When it runs without naming a LIMIT
      Then it returns a full page at the ceiling, with no truncation flag and no diagnostic

    # A result too wide to serialise is refused outright rather than cut, so a
    # partial body never masquerades as a whole one.
    @integration
    Scenario: A result past the byte ceiling is refused, never cut
      Given a query whose result exceeds the byte ceiling
      When it runs
      Then it is refused with lwql_result_too_large naming the byte cap, never a partial body

  Rule: The cap cannot be evaded

    # OFFSET alone does not page a result — OFFSET 5 with no LIMIT still
    # returns every remaining row — so it must not be mistaken for a clause
    # that already bounds the answer.
    @unit
    Scenario: An OFFSET with no LIMIT is still unbounded
      Given a statement that names OFFSET but no LIMIT of its own
      When it is validated
      Then it is flagged for the default row LIMIT to be appended before its OFFSET

    # Each branch of a UNION runs and returns independently, so a default
    # LIMIT appended once to the whole statement cannot bound a branch that
    # names none of its own.
    @unit
    Scenario: A UNION cannot rely on the default cap
      Given a UNION where one branch names no LIMIT of its own
      When it is validated
      Then it is refused with LIMIT_REQUIRED_PER_BRANCH naming every branch that needs one

    # The query docs and OpenAPI spec both document the per-branch LIMIT rule
    # so callers know to write their UNION branches correctly and why the
    # server rejects one that names none.
    @unit
    Scenario: Each UNION branch must carry its own LIMIT ceiling
      Given the query documentation and OpenAPI schema
      When they are read
      Then they name LIMIT_REQUIRED_PER_BRANCH and describe the per-branch LIMIT rule for UNION queries

    # A LIMIT written as a bound parameter is not a value the static validator
    # can read, so it passes both the append decision and the too-high check —
    # the server's own max_result_rows / max_result_bytes ceiling is what
    # still catches it.
    @integration
    Scenario: A parameterised LIMIT cannot outrun the server-side ceiling
      Given a query whose LIMIT is a bound parameter set above the row ceiling
      When it runs against a table with more rows than the ceiling
      Then it is refused with lwql_result_too_large, never a raw driver error

    # The unit proof above shows the default LIMIT is inserted before a bare
    # OFFSET rather than after it. This is the real-database half: a query
    # that reaches ClickHouse with OFFSET but no LIMIT — as it would if that
    # insertion were ever skipped — must not silently return every remaining
    # row past the ceiling.
    @integration
    Scenario: An OFFSET with no LIMIT cannot outrun the server-side ceiling
      Given a query with an OFFSET but no LIMIT of its own
      When it runs against more rows than the ceiling
      Then it is refused with lwql_result_too_large, never a raw driver error

    # LIMIT BY bounds rows per group, never the statement's total output, so a
    # statement naming only a LIMIT BY clause is not "already paged" either —
    # the server-side ceiling is what still catches it.
    @integration
    Scenario: A LIMIT BY clause cannot outrun the server-side ceiling
      Given a query whose only LIMIT clause is a LIMIT BY
      When it runs against more distinct groups than the ceiling
      Then it is refused with lwql_result_too_large, never a raw driver error
