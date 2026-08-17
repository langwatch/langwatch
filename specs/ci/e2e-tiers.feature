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

  # Every scenario below is @unimplemented, and that is a statement about the
  # PARITY CHECK rather than about the tests. The suite in tests/agentic-e2e
  # does assert these — tenant-isolation.spec.ts is written against this file
  # and says so in its header — but check-feature-parity only scans
  # `.test.ts` / `.test.tsx`, and Playwright specs are `.spec.ts`. No tag can
  # bind from there today, so claiming @e2e would report a binding that does
  # not exist.
  #
  # Teaching the checker to scan Playwright specs is a repo-wide change to what
  # counts as a test file, and it belongs in its own change rather than riding
  # in on this one. Until then these are parked honestly.

  Rule: Each test owns its own organisation and project

    @unimplemented
    Scenario: A test provisions its own tenant
      Given a headless test that needs a project
      When the test starts
      Then it is given an organisation and project created for it alone
      And an API key scoped to that project

    @unimplemented
    Scenario: Licence changes cannot leak between tests
      Given one test that activates an enterprise licence on its own organisation
      And another test that asserts its organisation is on the Free plan
      When both run at the same time
      Then each observes only its own organisation's plan

    @unimplemented
    Scenario: A failing test does not poison the ones after it
      Given a test that creates data and then fails partway through
      When the remaining tests run
      Then they are unaffected by the leftover data

  Rule: Headless tests carry no browser

    @unimplemented
    Scenario: The headless projects run without launching a browser
      Given the headless test projects
      When the suite runs
      Then no browser is launched for them
      And they run fully in parallel

    @unimplemented
    Scenario: Browser tests stay capped
      Given the browser test project
      When a contributor adds a test beyond the agreed cap
      Then the suite reports the cap has been exceeded

  Rule: Pull requests run the cheap tiers

    @unimplemented
    Scenario: A pull request runs headless coverage
      Given a pull request touching application code
      When continuous integration runs
      Then the headless projects run
      And the browser project does not

    @unimplemented
    Scenario: Scheduled runs exercise the browser happy paths
      Given the scheduled pre-release run
      When continuous integration runs
      Then the browser project runs

    @unimplemented
    Scenario: A hung environment fails rather than running until the job limit
      Given an application that never becomes ready
      When continuous integration runs the suite
      Then the job fails within its own timeout
