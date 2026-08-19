Feature: The React Compiler memoizes the app at build time
  As someone working on the LangWatch frontend
  I want components memoized by the compiler rather than by hand
  So that re-render cost is bounded by what the code actually reads, and not
    by whether anyone remembered to write useMemo

  # The compiler was enabled under Next.js (`experimental.reactCompiler`) and
  # was lost in the migration to Vite + Hono (#3170). Nothing failed: the build
  # kept working, `babel-plugin-react-compiler` stayed in package.json, and the
  # only signal was a bundle that no longer imported the compiler runtime. That
  # is the failure this feature exists to make loud — the wiring is one line in
  # a build config, and a build config has no user who notices when it goes.
  #
  # The @unit scenarios bind to platform/app/vite/reactCompiler.unit.test.ts,
  # which resolves the real vite config and runs the real Babel preset. They do
  # not build the app; what a full production build produces is asserted by the
  # build itself.

  # ===========================================================================
  # The compiler runs
  # ===========================================================================

  @unit
  Scenario: The build compiles the frontend
    Given someone builds the application
    When the frontend passes through the build
    Then the React Compiler transforms it
    # Vite's React plugin transforms with oxc and cannot host the compiler
    # itself, so the compiler runs as its own pass. A build that quietly stops
    # running that pass is indistinguishable from a build that never had it.

  @unit
  Scenario: A component is memoized without anyone writing a hook
    Given a component that derives a value on every render
    When the React Compiler transforms it
    Then the derived value is reused while its inputs are unchanged
    And the component needed no useMemo, useCallback or memo of its own

  # ===========================================================================
  # The compiler is not a new way for the build to fail
  # ===========================================================================

  @unit
  Scenario: Code the compiler cannot prove is left as it was written
    Given a component that breaks the rules of React
    When the React Compiler transforms it
    Then the component is left uncompiled
    And the build succeeds
    # The compiler bails out per component. The cost of an offending component
    # is that it loses the optimization, never that the frontend stops
    # building — which is what makes turning this on a safe default rather
    # than a codebase-wide cleanup that has to land first.
