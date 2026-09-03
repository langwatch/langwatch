# Renamed from `user-avatar.feature` when the platform application's second
# specs root merged into this one. `user-avatar.feature` is a different
# feature that happened to share the filename: it covers every way a photo is
# refused, and the one sentence a customer reads for each. This one covers the
# upload itself — storage, the SSO precedence, and where the photo renders.
Feature: Uploading a custom avatar photo
  As a LangWatch user
  I want to upload my own profile photo
  So that my identity is recognizable everywhere the app shows a person — traces,
  prompts, member lists, annotations — instead of a generic icon or a photo my SSO
  provider happened to return

  # ---------------------------------------------------------------------------
  # Today a user's photo lives in the single `User.image` column and is written
  # ONLY by the SSO/OAuth providers at first sign-in. Email/password users have
  # no photo; SSO users are stuck with their identity provider's picture.
  #
  # This feature adds a second, user-controlled writer of `User.image`: an upload
  # that stores the image in the existing S3-backed object storage (falling back
  # to local disk when S3 is not configured) and serves it back through an
  # authenticated, same-origin route so any signed-in teammate can see it.
  #
  # Because every avatar in the product resolves from that one field through the
  # same `uploaded/SSO image -> initials -> silhouette` fallback chain, a photo
  # set here propagates to every surface that renders the field.
  #
  # Scope: per-user (account level), not team level.
  # ---------------------------------------------------------------------------

  # --- Setting and removing the photo -----------------------------------------

  @integration
  Scenario: Uploading a photo stores it and sets it as the user's avatar
    Given a signed-in user with no custom avatar
    When they upload a valid image from their profile settings
    Then the image is stored in object storage owned by that user
    And the user's avatar now resolves to the uploaded photo

  @integration
  Scenario: The profile settings show a live preview before saving
    Given a signed-in user on their profile settings
    When they choose an image file
    Then a preview of the cropped photo is shown before it is saved

  @integration
  Scenario: Removing the photo reverts to the fallback avatar
    Given a signed-in user who has uploaded a custom avatar
    When they remove their photo from profile settings
    Then the user's avatar no longer resolves to an uploaded photo
    And the avatar falls back to their initials

  # --- Constraints ------------------------------------------------------------

  @integration
  Scenario: An oversized image is rejected
    Given a signed-in user on their profile settings
    When they upload an image larger than the maximum allowed size
    Then the upload is rejected with a clear error
    And the user's avatar is unchanged

  @integration
  Scenario: A non-image file is rejected
    Given a signed-in user on their profile settings
    When they upload a file that is not an allowed image type
    Then the upload is rejected with a clear error
    And the user's avatar is unchanged

  # --- Precedence vs SSO ------------------------------------------------------

  @integration
  Scenario: An uploaded photo wins over the SSO provider photo
    Given a user whose avatar came from their SSO provider
    When they upload their own photo
    Then their avatar resolves to the uploaded photo, not the SSO photo

  @integration
  Scenario: Signing in again through SSO does not overwrite an uploaded photo
    Given a user who has uploaded their own photo
    When they sign in again through their SSO provider
    Then their uploaded photo is preserved

  # --- Serving and visibility -------------------------------------------------

  @integration
  Scenario: A signed-in teammate can load another user's uploaded avatar
    Given a user who has uploaded a custom avatar
    And a different signed-in teammate in the same organization
    When the teammate's browser requests that user's avatar image
    Then the image is served to them

  @integration
  Scenario: An unauthenticated request cannot load an avatar image
    Given a user who has uploaded a custom avatar
    When an unauthenticated request is made for that avatar image
    Then the request is rejected

  # The avatar route is readable by ANY signed-in person on the platform, because
  # a photo has to show wherever a person is shown and that crosses organizations.
  # What keeps that breadth from being a door onto every tenant's trace and
  # scenario media is the route's own refusal: it serves an object only when both
  # what the object is FOR and what PRODUCED it are the avatar ones. That check
  # is only real if the object read answers with the owner kind, which is why
  # these scenarios describe the read and not only the upload.

  @integration
  Scenario: The avatar route serves an object whose purpose and owner kind are the avatar ones
    Given a signed-in person and a stored photo uploaded by a user
    When they request that photo by its address
    Then the image is served to them with the type it was stored as

  @integration
  Scenario: An object that is not a user avatar is refused rather than served
    Given a signed-in person and a stored object that is trace media rather than a photo
    When they request it through the avatar address
    Then no bytes are served
    And the refusal says there is no photo at that address

  @unit
  Scenario: A URL with no avatar behind it is refused the same way as a foreign object
    Given a signed-in person and an address with no photo behind it
    When they request it through the avatar address
    Then the refusal is the same one a foreign object gets
    And they learn nothing about whether an object with that address exists

  @integration
  Scenario: The avatar route is left off a process that cannot authenticate an image request
    Given a deployment whose photo route cannot accept a browser's own credentials
    When the deployment starts
    Then the photo route is not served at all
    And people fall back to initials rather than meeting a refusal on every photo

  # --- Rendering across the product ------------------------------------------

  @integration
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

  @integration
  Scenario: A user without a photo still shows their initials everywhere
    Given a user who has not uploaded a photo and has no SSO photo
    When their avatar is rendered on any surface
    Then their initials are displayed as the fallback
