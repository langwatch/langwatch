# The lint half of packages/eventing/specs/event-upcast.feature: that spec owns
# what a drain does, this one owns the rule that retires it after one release.

Feature: The linter retires upcast drains after one release
  As a platform maintainer
  I want a drain past its release named by the linter
  So that dead routing from a renamed pipeline is deleted on time

  Background:
    Given the langwatch oxlint plugin runs over the workspace sources

  Rule: A drain declares the release after which it is deleted

    @unit
    Scenario: A drain past its release is reported
      Given production source whose upcast drain names a release that has been cut
      When the rule runs
      Then it reports the drain and names both releases

    @unit
    Scenario: A drain inside its release is left alone
      Given production source whose upcast drain names a release still to come
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: A drain without a release is reported
      Given production source whose upcast drain names no removeAfter release
      When the rule runs
      Then it reports the missing window

    @unit
    Scenario: Upcasts without a drain are left alone
      Given production source whose upcasts declare no drain
      When the rule runs
      Then it reports nothing
