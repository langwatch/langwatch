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
