Feature: E2E test tiers and isolation

  The E2E suite is split by cost, not by feature area. Browser tests are
  expensive and stay capped; headless tests cross real process boundaries
  without a browser, cost little, and grow with the product.

  The split only works if tests stop sharing state. Historically the whole
  suite ran one test at a time because every test used the same organisation,
  and the members tests toggled an enterprise licence on it — a licence window
  that would leak into any test asserting the Free plan. Per-test provisioning
  is what makes the parallelism safe, so it is a rule of the harness rather
  than a convention.

  See dev/docs/adr/010-e2e-testing-strategy.md (headless-tier amendment).

  Rule: Each test owns its own organisation and project

    Scenario: A test provisions its own tenant
      Given a headless test that needs a project
      When the test starts
      Then it is given an organisation and project created for it alone
      And an API key scoped to that project

    Scenario: Licence changes cannot leak between tests
      Given one test that activates an enterprise licence on its own organisation
      And another test that asserts its organisation is on the Free plan
      When both run at the same time
      Then each observes only its own organisation's plan

    Scenario: A failing test does not poison the ones after it
      Given a test that creates data and then fails partway through
      When the remaining tests run
      Then they are unaffected by the leftover data

  Rule: Headless tests carry no browser

    Scenario: The headless projects run without launching a browser
      Given the headless test projects
      When the suite runs
      Then no browser is launched for them
      And they run fully in parallel

    Scenario: Browser tests stay capped
      Given the browser test project
      When a contributor adds a test beyond the agreed cap
      Then the suite reports the cap has been exceeded

  Rule: Pull requests run the cheap tiers

    Scenario: A pull request runs headless coverage
      Given a pull request touching application code
      When continuous integration runs
      Then the headless projects run
      And the browser project does not

    Scenario: Scheduled runs exercise the browser happy paths
      Given the scheduled pre-release run
      When continuous integration runs
      Then the browser project runs

    Scenario: A hung environment fails rather than running until the job limit
      Given an application that never becomes ready
      When continuous integration runs the suite
      Then the job fails within its own timeout
