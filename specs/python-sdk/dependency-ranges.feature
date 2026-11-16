Feature: Python SDK dependency ranges admit only versions it imports under
  As a developer who runs `pip install langwatch`
  I want a fresh install to resolve dependencies the SDK actually works with
  So that `import langwatch` never fails because an upstream major shipped

  Background: a fresh install is unlocked.
    pip ignores our uv.lock and takes the newest version each declared range
    admits. python-liquid 3.0.0 removed `liquid.exceptions.UndefinedError`,
    which the prompts module imports, so an uncapped range broke every fresh
    install of 1.4.0. The python-liquid range is capped below that untested
    major and floored at the first release without a known advisory.

  @unit
  Scenario: The python-liquid range stops below the untested major 3
    Given the SDK's declared dependencies
    When the python-liquid requirement is read
    Then it admits 2.2.1 and the newest 2.x
    And it refuses 2.2.0, which carries the 2.2.1 advisories
    And it refuses 3.0.0

