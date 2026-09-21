Feature: The CLI reads the way an agent expects
  As an AI coding agent that drives the LangWatch CLI
  I want the read flags to accept the expressions I already know
  So that one call answers the question and I do not shell out to another tool

  # Seen while dogfooding: the agent was asked how many prompts a project has.
  # `--jq length` was refused because the subset wanted `. | length`, `--limit`
  # was refused because the prompts list had no such flag, so the agent ran a
  # Python one-liner instead. That failed, and the user got a Python traceback
  # in the chat beside an otherwise correct answer.

  Rule: The filter accepts the jq spellings an agent types first

    @unit
    Scenario: A list is counted with no pipe in front of length
      Given a result that holds 44 prompts
      When the caller filters it with "length"
      Then the CLI answers 44

    @unit
    Scenario: An index reads one row out of a list
      Given a result that holds a list of traces
      When the caller filters it with ".traces[0].traceId"
      Then the CLI answers the first trace's id

    @unit
    Scenario: A negative index counts from the end
      Given a result that holds a list of traces
      When the caller filters it with ".traces[-1].traceId"
      Then the CLI answers the last trace's id

    @unit
    Scenario: An index past the end answers null
      Given a result that holds a list of traces
      When the caller filters it with ".traces[9]"
      Then the CLI answers null, the same as jq

    @unit
    Scenario: An index into something that is not a list is refused
      Given a result whose "pagination" field is an object
      When the caller filters it with ".pagination[0]"
      Then the CLI refuses the expression and names the field

    @unit
    Scenario: Syntax the subset does not implement is still refused
      Given any result
      When the caller filters it with quoting, optionals, operators or function calls
      Then the CLI refuses the expression instead of answering null

  Rule: Every list command takes the flag that caps a result

    # About twenty commands page with a --limit of their own, so the flag reads
    # as universal. The rest answered "unknown option '--limit'" and a usage
    # dump. The cap is a projection, like the filter: it says how many rows to
    # print, not how many to fetch.

    @unit
    Scenario: A list is cut to the first rows on any list command
      Given a command that returns 2 rows
      When the caller asks for json output with a limit of 1
      Then the result holds the first row alone

    @unit
    Scenario: A cut list envelope keeps everything it says about itself
      Given a command that returns rows beside a pagination field
      When the caller asks for json output with a limit of 1
      Then the rows are cut and the pagination field is unchanged

    @unit
    Scenario: A payload that is not a list is left whole
      Given a command that returns one resource with several fields
      When the caller asks for json output with a limit of 1
      Then the resource is printed whole

    @unit
    Scenario: A command with its own paging flag keeps it
      Given a command that pages with a limit of its own
      When the caller asks for json output with a limit of 1
      Then the command receives the limit and the result is not cut again

  Rule: A paginated list says how many there are under one name

    # Counting is a normal thing to want, and the CLI gave two answers to it:
    # `.pagination.total` on the resource lists and `.pagination.totalHits` on
    # the search-backed ones. A caller that read the first got null on a trace
    # search and went looking for another way to count. The field the API sent
    # is kept, so nothing that reads `totalHits` breaks.

    @unit
    Scenario: A search-backed list also carries the total under the common name
      Given a result whose pagination holds totalHits
      When the caller asks for json output
      Then the pagination holds the same number as total
      And it still holds totalHits

    @unit
    Scenario: The total survives a capped page
      Given a result of 2 rows whose pagination says there are 40
      When the caller asks for json output with a limit of 1
      Then one row is printed and the total still reads 40

    @unit
    Scenario: A result with no pagination is left alone
      Given a result that carries no pagination
      When the caller asks for json output
      Then the result is printed as it was

  Rule: A list command takes the paging flag the other list commands take

    @unit
    Scenario: The prompts list is cut to the first rows
      Given a project with 44 prompts
      When the caller runs the prompts list with a limit of 5
      Then the result holds 5 prompts

    @unit
    Scenario: A cut prompts list says how many prompts exist
      Given a project with 44 prompts
      When the caller runs the prompts list with a limit of 5
      Then the table states that it shows 5 of 44

    @unit
    Scenario: A limit above the number of prompts changes nothing
      Given a project with 44 prompts
      When the caller runs the prompts list with a limit of 100
      Then the result holds all 44 prompts
      And the table states no partial count
