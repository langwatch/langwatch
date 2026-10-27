Feature: The worker's public voice origin is acquired on the first voice run

  A worker with no configured VOICE_PUBLIC_BASE_URL and the tunnel on opens a quick
  tunnel to its media door. Opening it costs seconds and can wait minutes on DNS, so
  boot never waits for it: the first voice run acquires it, and every later run shares it.

  @unit
  Scenario: A worker boots without waiting for the voice tunnel
    Given a worker with the voice tunnel on and no configured public origin
    When the worker boots and runs only non-voice scenarios
    Then no tunnel is opened

  @unit
  Scenario: The first voice run opens the tunnel once for every concurrent caller
    Given a worker with the voice tunnel on and no configured public origin
    When two voice runs ask for the public origin at the same time, and a third asks later
    Then one tunnel is opened and all three runs receive its origin
    And the tunnel is closed when the worker shuts down

  @unit
  Scenario: A voice tunnel that fails on first use names its reason to the phone run
    Given a worker whose voice tunnel fails to open
    When a voice run asks for the public origin
    Then the run's child is started with the tunnel's failure reason instead of an origin
    And later voice runs receive the same reason without another attempt
