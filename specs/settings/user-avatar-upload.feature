Feature: Uploading a custom avatar photo
  As a LangWatch user
  I want to upload my own profile photo
  So that my identity is recognizable everywhere the app shows a person — traces,
  prompts, member lists, annotations — instead of a generic icon or a photo my SSO
  provider happened to return

  # ---------------------------------------------------------------------------
  # A user's photo lives in the single `User.image` column. It used to be written
  # ONLY by the SSO/OAuth providers at first sign-in, so email/password users had
  # no photo and SSO users were stuck with their identity provider's picture.
  #
  # This feature adds a second, user-controlled writer of that same field: an
  # upload that stores the image in the existing S3-backed object storage under
  # the uploader's personal project, tagged with the `user_avatar` purpose, and
  # serves it back through an authenticated, same-origin route so any signed-in
  # teammate can see it.
  #
  # Because every avatar in the product resolves from that one field through the
  # same `uploaded/SSO image -> initials -> silhouette` fallback chain, a photo
  # set here propagates to every surface that renders the field.
  #
  # Scope: per-user (account level), not team level.
  #
  # The REFUSAL side of this feature — which reasons a rejected photo carries and
  # how the two halves agree on them — is specified separately in
  # specs/settings/user-avatar.feature and is not repeated here.
  # ---------------------------------------------------------------------------

  # --- Setting and removing the photo -----------------------------------------

  @unit
  Scenario: Uploading a photo stores it and sets it as the user's avatar
    Given a signed-in user with no custom avatar
    When they upload a valid image from their profile settings
    Then the image is stored in object storage owned by that user
    And the user's avatar now resolves to the uploaded photo

  # Nothing renders the profile settings form, so the crop preview is unproven.
  @integration @unimplemented
  Scenario: The profile settings show a live preview before saving
    Given a signed-in user on their profile settings
    When they choose an image file
    Then a preview of the cropped photo is shown before it is saved

  @unit
  Scenario: Removing the photo clears the uploaded avatar
    Given a signed-in user who has uploaded a custom avatar
    When they remove their photo from profile settings
    Then the user's avatar no longer resolves to an uploaded photo

  # --- Precedence vs SSO ------------------------------------------------------

  # The upload path is proven to write `User.image`; what is NOT proven is that
  # it does so over a value the SSO provider put there first, because no test
  # establishes that starting state.
  @unit @unimplemented
  Scenario: An uploaded photo wins over the SSO provider photo
    Given a user whose avatar came from their SSO provider
    When they upload their own photo
    Then their avatar resolves to the uploaded photo, not the SSO photo

  @unit
  Scenario: Signing in again through SSO does not overwrite an uploaded photo
    Given a user who has uploaded their own photo
    When they sign in again through their SSO provider
    Then their uploaded photo is preserved

  # --- Serving and visibility -------------------------------------------------

  # /api/user-avatar has no test of its own. Its authorization posture is
  # deliberate and unusual — ANY authenticated caller may read, which is only
  # safe because the route refuses every stored object not tagged `user_avatar`
  # — so it is exactly the route that should not be trusted untested.
  @integration @unimplemented
  Scenario: A signed-in teammate can load another user's uploaded avatar
    Given a user who has uploaded a custom avatar
    And a different signed-in teammate in the same organization
    When the teammate's browser requests that user's avatar image
    Then the image is served to them

  @integration @unimplemented
  Scenario: An unauthenticated request cannot load an avatar image
    Given a user who has uploaded a custom avatar
    When an unauthenticated request is made for that avatar image
    Then the request is rejected

  @integration @unimplemented
  Scenario: The avatar route refuses a stored object that is not an avatar
    Given a stored object that is not tagged with the user-avatar purpose
    When it is requested through the avatar route
    Then the request is refused as not found

  # --- Rendering across the product ------------------------------------------

  @integration @unimplemented
  Scenario Outline: The uploaded photo renders wherever a person is shown
    Given a user who has uploaded a custom avatar
    When their avatar is rendered in the "<surface>"
    Then the uploaded photo is displayed instead of their initials

    Examples:
      | surface                        |
      | header account menu            |
      | organization members list      |
      | prompt version history author  |
      | trace annotation author        |

  @integration @unimplemented
  Scenario: A user without a photo still shows their initials everywhere
    Given a user who has not uploaded a photo and has no SSO photo
    When their avatar is rendered on any surface
    Then their initials are displayed as the fallback
