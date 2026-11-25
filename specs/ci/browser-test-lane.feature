Feature: The real-browser test lane runs, and only where React is
  As a developer asserting on layout, canvas and pointer behaviour
  I want a browser lane that CI actually invokes
  So that a test jsdom cannot answer is not silently answered by nobody

  # Two packages declared a real-browser lane before this one existed, and
  # neither ever ran. `analytics-web` wrote four Vega tests and a
  # `test:browser` script that no workflow and no script invoked — its own
  # config blamed a runner script that had itself been renamed since.
  # `experiment-web` wrote a hover test under `src/**` and an include glob
  # matching `tests/**`, so its lane collected zero files and exited 0. A lane
  # that collects nothing and a lane nobody calls both report success, which is
  # why neither gap was noticed.
  #
  # So the lane is declared through the shared harness rather than hand-rolled
  # per package, and CI derives the packages to run from the manifests rather
  # than from a hand-maintained list. A package that declares the lane is run
  # by construction, and a lane whose glob matches nothing fails instead of
  # passing.

  Background:
    Given the browser lane runs in a real Chromium through Playwright
    And the jsdom lane remains the default for component tests

  Rule: a declared browser lane is a lane CI runs

    @unit
    Scenario: A package declaring the browser lane is discovered by CI
      Given a package whose manifest declares a browser test script
      When CI collects the packages to run in the browser lane
      Then that package is in the list

    # The install belongs to the lane's own script because only the owning
    # package resolves the right playwright — there is none at the repo root,
    # so an install orchestrated from there takes whatever is on PATH and the
    # lane cannot find the browser build it then expects.

    @unit
    Scenario: The browser lane installs its own browser
      Given a package declaring the browser lane
      When its browser test script is read
      Then the script installs the browser it runs against

    @unit
    Scenario: A browser lane that collects no test files is a failure
      Given a package declaring the browser lane
      And its configured include glob matches no file in the package
      When the lane is checked
      Then the check fails naming the package and the glob

    @unit
    Scenario: A browser test outside the configured glob is reported
      Given a package containing a file named for the browser lane
      And the package's browser configuration would not collect it
      When the lane is checked
      Then the check fails naming the uncollected file

  Rule: React testing dependencies belong only to web packages

    # A contract or server package that grows a React testing dependency is
    # either testing a component it should not own, or carrying a dependency
    # nothing imports. Both are worth failing over, and the manifest is where
    # it is cheapest to see.

    @unit
    Scenario: A web package may declare the React browser renderer
      Given a package whose directory is a web package
      When its manifest declares the React browser renderer
      Then the check passes

    @unit
    Scenario: A server package may not declare a React testing dependency
      Given a package whose directory is a server package
      When its manifest declares a React testing dependency
      Then the check fails naming the package and the dependency

    @unit
    Scenario: A contract package may not declare a React testing dependency
      Given a package whose directory is a contract package
      When its manifest declares a React testing dependency
      Then the check fails naming the package and the dependency

  Rule: the browser lane supplies its own DOM matchers

    # `@vitest/browser` ships the jest-dom matcher set itself. A browser-lane
    # file importing `@testing-library/jest-dom` is loading a second copy of
    # matchers it already has, and a browser-lane package declaring the
    # dependency is carrying it for nothing. The jsdom lane still needs both.

    @unit
    Scenario: A browser test does not import the jest-dom matchers
      Given a test file in the browser lane
      When it imports the jest-dom matcher registration
      Then the check fails naming the file

    @unit
    Scenario: A jsdom test keeps its jest-dom import
      Given a test file in the jsdom lane
      When it imports the jest-dom matcher registration
      Then the check passes
