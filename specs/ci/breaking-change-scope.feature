Feature: A breaking change belongs to one release component
  As someone reading a LangWatch release
  I want a major version to mean that LangWatch broke
  So that a break in an SDK never stalls the platform and its Helm chart

  # release-please decides which components a commit affects by path, then
  # applies the WHOLE commit message to every one of them. It has no way to say
  # "this break is only about the Go SDK". `release-scope-guard` is what keeps
  # that from happening, by refusing a pull request whose breaking marker spans
  # components.
  #
  # #4998 is why a pin no longer counts as an exemption. It carried two Go SDK
  # breaks alongside ~1,700 lines of ordinary platform code, pinned the platform
  # to 3.13.0 the way the procedure then described, and the guard passed it.
  # Both halves of that failed:
  #
  #   - `Release-As:` overrides the version and NOTHING else, so the Go SDK's
  #     breaks were still filed under the platform's changelog.
  #   - Squash is the only merge method here, so seventeen commits became one
  #     carrying both footers and touching every path. Only the sdks/go pin
  #     applied. The platform went to 4.0.0.
  #
  # Release PR #6787 then stalled on a major nobody wanted, and the #6842 Helm
  # chart fix waited behind it, because the chart ships from the app release
  # train. See dev/docs/RELEASES.md.

  Background:
    Given a pull request whose title or commits carry a breaking-change marker

  @unit
  Scenario: A break confined to one component passes
    Given every changed file belongs to the same release component
    When the scope guard runs
    Then the check passes naming the component the break is scoped to

  @unit
  Scenario: A break spanning two components fails
    Given the changed files belong to two release components
    When the scope guard runs
    Then the check fails listing both components the break reaches

  @unit
  Scenario: A pin does not exempt a component from the scope check
    Given the pull request pins every component it must not major
    When the scope guard runs
    Then the check still fails
    And it says a pin fixes the version and leaves the break in the changelog

  @unit
  Scenario: A Go SDK break never reaches the platform release
    Given the breaking commits describe the Go SDK
    And the pull request also changes platform application code
    When the scope guard runs
    Then the check fails naming both the platform and the Go SDK

  @unit
  Scenario: One incidental file is enough to widen the scope
    Given the breaking commits describe the Go SDK
    And a single incidental file belongs to another release component
    When the scope guard runs
    Then the check fails naming that other component
