Feature: Trace content is redacted for readers without the privacy permission

  A project's privacy level decides who reads message content versus who
  reads a redaction placeholder, and a cached decision must not outlive the
  policy it was derived from.

  # trace-read-redaction.service.ts, data-privacy-resolution.service.ts,
  # data-privacy-cache.service.ts, data-privacy-snapshot.service.ts,
  # content-drop-policy.service.ts, data-privacy-scope-authorization.service.ts

  @unit @unimplemented
  Scenario: A reader without the privacy permission sees redacted trace content
    Given a project whose privacy level hides message content
    When a member without the privacy permission reads a trace
    Then the message content is redacted and the metadata is not

  @unit @unimplemented
  Scenario: A share link reader never sees more than the share's privacy level allows
    Given a shared trace in a project that drops input content
    When an anonymous viewer opens the share link
    Then the dropped content is absent from the response

  @unit @unimplemented
  Scenario: A cached privacy decision is invalidated when the policy changes
    Given a privacy resolution cached for a project
    When the project's privacy level changes
    Then the next read uses the new level, not the cached one

  @unit
  Scenario: A reader with full visibility sees no privacy marker when nothing was dropped
    Given a trace with no dropped content
    When a reader with full visibility reads it
    Then the trace carries no privacy marker
