Feature: Rotating a revoked virtual key
  The REST family maps every refusal through a HandledError; a bare TRPCError
  thrown from a REST handler is not recognised and falls back to a generic
  500, so the rotation service's own refusal must be a HandledError.

  @integration
  Scenario: Rotating a revoked virtual key answers 400, not the generic 500 an unhandled error would
    Given a virtual key that has been revoked
    When its secret is rotated
    Then the answer is 400 with the bad_request code, not a 500
