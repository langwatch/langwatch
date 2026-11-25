Feature: The require-fetch-timeout lint rule
  A channel is how a module talks to what it does not own. A `fetch` with no
  abort signal hangs its caller for as long as the peer keeps the socket open,
  so every channel fetch carries `signal: AbortSignal.timeout(ms)` or a
  controller's signal.

  @unit
  Scenario: A channel fetch without an abort signal is reported
    Given a channel that calls fetch with no init, and globalThis.fetch with an init that has no signal
    When the require-fetch-timeout rule runs over it
    Then it reports fetchWithoutSignal on each call's line

  @unit
  Scenario: A channel fetch with an abort signal is left alone
    Given a channel whose fetch inits carry a signal, spread another init, or are passed through whole
    When the require-fetch-timeout rule runs over it
    Then it reports nothing
