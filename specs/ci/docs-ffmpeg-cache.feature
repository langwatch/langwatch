Feature: The docs build caches the ffmpeg packages per runner image
  As a developer waiting on the docs build
  I want ffmpeg's .deb files restored rather than downloaded
  So that a slow Ubuntu mirror stalls one run per runner image, not every run

  # tasks#1215: a slow mirror can trickle one package for minutes, which no apt
  # timeout catches. The docs-media-encoders action keeps the downloaded
  # packages in the Actions cache, keyed by the runner image.

  @unit
  Scenario: A cold run installs ffmpeg and saves the packages it downloaded
    Given there was no exact docs-media cache hit
    And no cache entry exists for the runner image's key
    When the action runs
    Then ffmpeg is installed with apt downloading into the cached directory
    And that directory is saved under the runner image's key

  @unit
  Scenario: A warm run installs from the restored packages
    Given there was no exact docs-media cache hit
    And a cache entry exists for the runner image's key
    When the action runs
    Then the packages are restored into the directory apt downloads to
    And ffmpeg is installed without downloading them from the mirror
    And nothing is saved

  @unit
  Scenario: A failed install saves nothing
    Given there was no exact docs-media cache hit
    And the ffmpeg install fails or times out
    When the job stops
    Then the save step does not run, so a half download is never cached

  @unit
  Scenario: An exact docs-media cache hit skips the ffmpeg steps
    Given the encoded docs media was restored by an exact key match
    When the action runs
    Then the ffmpeg key, restore, install and save steps are all skipped

  @unit
  Scenario: A new runner image downloads once and saves again
    Given there was no exact docs-media cache hit
    And the key names the runner OS, image and image version
    When the runner image changes
    Then the old entry is not restored
    And the packages are downloaded once and saved under the new key
