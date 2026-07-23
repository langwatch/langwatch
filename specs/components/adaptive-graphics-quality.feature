Feature: The app backs off decorative blur effects on a struggling device
  As a user on an underpowered or overloaded machine
  I want frosted-glass panels, drawers, and dialogs to stop blurring
  So that the app stays responsive instead of stuttering to keep up a visual effect

  # ---------------------------------------------------------------------------
  # A background probe periodically samples real frame rate. When the device
  # can't sustain a smooth frame rate across consecutive sample windows,
  # decorative blur/backdrop effects across the app (sticky run-history
  # headers, dialogs, drawers, menus, toasts, tooltips) switch to a plain
  # background instead — same layout, no blur. The probe keeps re-checking,
  # so the app recovers automatically once the device is no longer under
  # load. Backdrop-filter is a static effect rather than motion, so the probe
  # runs (and can still help) even for users who prefer reduced motion. A
  # sample window is discarded rather than counted if the tab was backgrounded
  # partway through it, since a backgrounded tab's real elapsed time no longer
  # reflects how many frames it should have rendered.
  #
  # A manual choice (always reduce / never reduce / let the automatic check
  # decide) is available on top of the automatic probe, for anyone who already
  # knows their situation and doesn't want to wait for a check. It's remembered
  # on this device.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A frame rate below the floor is reported as struggling
    Given a sample window observed 40 frames over 1500ms
    When the sample is evaluated against a 50fps floor
    Then the device is reported as struggling

  @unit
  Scenario: A frame rate at or above the floor is reported as smooth
    Given a sample window observed 90 frames over 1500ms
    When the sample is evaluated against a 50fps floor
    Then the device is reported as smooth

  @unit
  Scenario: A sample window with no observed frames is reported as struggling
    Given a sample window observed 0 frames over 1500ms
    When the sample is evaluated against a 50fps floor
    Then the device is reported as struggling

  @integration
  Scenario: Blur effects turn off when the device can't keep a smooth frame rate
    Given the background probe is running
    When consecutive sample windows measure frames well below the smooth floor
    Then the app marks itself as running in reduced-graphics mode
    And decorative blur effects across the app stop rendering their blur

  @integration
  Scenario: A single stray struggling window is not enough to degrade
    Given the background probe is running
    When one sample window measures frames well below the smooth floor
    And the following sample window measures a smooth frame rate
    Then the app never marks itself as running in reduced-graphics mode

  @integration
  Scenario: Blur effects come back once the device recovers
    Given the app is currently in reduced-graphics mode
    When a later sample window measures a smooth frame rate again
    Then the app leaves reduced-graphics mode
    And decorative blur effects render normally again

  @integration
  Scenario: The probe still runs for users who prefer reduced motion
    Given the user's system preference is set to reduce motion
    When consecutive sample windows measure frames well below the smooth floor
    Then the app marks itself as running in reduced-graphics mode

  @integration
  Scenario: A sample window straddling a hidden tab is discarded
    Given the background probe has an in-progress sample window
    When the tab is backgrounded partway through that window
    And the tab becomes visible again
    Then that sample window is discarded instead of counted
    And the app does not mark itself as running in reduced-graphics mode

  @integration
  Scenario: The background probe stays idle between checks
    Given a sample window has just closed
    When the app waits for the next scheduled check
    Then the probe does no work in the meantime
    And it resumes checking once the wait is over

  @integration
  Scenario: A manual choice to always reduce graphics is respected
    Given the user has chosen to always reduce graphics on this device
    When the automatic check would otherwise measure a smooth frame rate
    Then the app stays in reduced-graphics mode

  @integration
  Scenario: A manual choice to never reduce graphics is respected
    Given the user has chosen to never reduce graphics on this device
    When the automatic check would otherwise measure a struggling frame rate
    Then the app never marks itself as running in reduced-graphics mode

  @integration
  Scenario: Choosing automatic hands control back to the probe
    Given the user had chosen to always reduce graphics on this device
    When the user switches the choice back to automatic
    Then the automatic check resumes deciding reduced-graphics mode
