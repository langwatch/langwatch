Feature: Production bundle integrity
  As an engineer shipping the app
  I want the production bundle verified before release
  So that bundler chunk-splitting regressions fail CI instead of users

  # A successful `vite build` only proves the bundle compiles. It does not catch
  # a bundle that breaks at runtime because the bundler split a cross-chunk
  # export into a chunk that references a not-yet-initialized binding — which
  # white-screens at boot (the Shiki regression) or throws "X is not a
  # constructor" when a lazy chunk's top-level code runs (server-only code such
  # as `new AsyncLocalStorage()` leaking into a client chunk). The boot smoke
  # test (scripts/smoke-boot.mjs) loads the built bundle in a headless browser
  # to catch both.

  Scenario: The built app mounts
    Given the production bundle is built and served
    When a headless browser loads the app
    Then the app mounts instead of white-screening

  Scenario: Every emitted chunk evaluates without a module-init error
    Given the production bundle is built and served
    When the smoke test imports each emitted chunk
    Then no chunk throws while its top-level code runs
    And a server-only construct leaking into a client chunk fails the smoke test

  # Known gap: this is an initialization-time net. A bug that only throws when a
  # function is called (not when its module loads) — like the trace id
  # generator crash — is invisible here and is covered by interaction/e2e tests
  # instead.
