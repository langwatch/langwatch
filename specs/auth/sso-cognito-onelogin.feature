Feature: Sign in with Amazon Cognito or OneLogin

  Self-hosted deployments federate to one identity provider, named by
  NEXTAUTH_PROVIDER. Cognito and OneLogin join the providers already supported,
  so an operator whose company already runs one of them does not have to stand
  up a second identity provider just to sign in to LangWatch.

  Both speak OpenID Connect, so both are configured the way Okta already is:
  the operator supplies a client id, a client secret and the issuer URL, and
  the deployment reads every endpoint it needs from the issuer's discovery
  document. Nothing else is asked of them. For Cognito in particular the
  discovery document is what carries the hosted-UI domain, so the operator
  never has to find and copy that domain separately.

  Background:
    Given a self-hosted deployment holding an Enterprise license

  # ==========================================================================
  # Mounting the provider
  # ==========================================================================

  @unit
  Scenario: Cognito mode
    Given NEXTAUTH_PROVIDER is "cognito"
    And COGNITO_CLIENT_ID, COGNITO_CLIENT_SECRET and COGNITO_ISSUER are set
    When the deployment starts
    Then a "cognito" provider is mounted
    And its endpoints are discovered from the issuer

  @unit
  Scenario: OneLogin mode
    Given NEXTAUTH_PROVIDER is "onelogin"
    And ONELOGIN_CLIENT_ID, ONELOGIN_CLIENT_SECRET and ONELOGIN_ISSUER are set
    When the deployment starts
    Then a "onelogin" provider is mounted
    And its endpoints are discovered from the issuer

  @unit
  Scenario: Only the named provider is mounted
    Given NEXTAUTH_PROVIDER is "cognito"
    And credentials for both Cognito and OneLogin are present
    When the deployment starts
    Then only the "cognito" provider is mounted

  # An operator who sets the provider name but forgets a credential should get a
  # deployment they can still sign in to and a log line naming what is missing,
  # not a sign-in page pointing at an identity provider that was never wired up.
  @unit
  Scenario: A provider missing its credentials falls back to email mode
    Given NEXTAUTH_PROVIDER is "onelogin"
    And ONELOGIN_CLIENT_SECRET is not set
    When the deployment starts
    Then no identity provider is mounted
    And the deployment starts in email mode
    And a warning names the provider it could not mount

  # ==========================================================================
  # Issuer handling
  #
  # The issuer is the only endpoint the operator supplies, so a value that is
  # merely untidy must not become a failure they have to debug at first sign-in.
  # ==========================================================================

  @unit
  Scenario Outline: An untidy issuer is still understood
    Given NEXTAUTH_PROVIDER is "<provider>"
    And the issuer is written as "<issuer>"
    When the deployment starts
    Then the provider discovers its endpoints from "<discovery>"

    Examples:
      | provider | issuer                                                          | discovery                                                                                |
      | cognito  | https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_abc | https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_abc/.well-known/openid-configuration |
      | cognito  | cognito-idp.eu-central-1.amazonaws.com/eu-central-1_abc         | https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_abc/.well-known/openid-configuration |
      | cognito  | https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_abc/ | https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_abc/.well-known/openid-configuration |
      | onelogin | https://acme.onelogin.com/oidc/2                                | https://acme.onelogin.com/oidc/2/.well-known/openid-configuration                        |
      | onelogin | acme.onelogin.com/oidc/2/                                       | https://acme.onelogin.com/oidc/2/.well-known/openid-configuration                        |

  @unit
  Scenario: An unusable issuer is rejected by name
    Given NEXTAUTH_PROVIDER is "cognito"
    And COGNITO_ISSUER cannot be read as a URL
    When the deployment starts
    Then startup fails with an error naming COGNITO_ISSUER and the value it rejected

  # ==========================================================================
  # Callback URL
  #
  # The operator registers one redirect URL with their identity provider, and
  # the docs give a single rule for every provider we support. A provider that
  # quietly used a different path would send them to a support ticket.
  # ==========================================================================

  @unit
  Scenario Outline: The callback URL follows the same rule as every other provider
    Given NEXTAUTH_PROVIDER is "<provider>"
    When the deployment starts
    Then the provider's redirect URL is the deployment URL followed by "/api/auth/callback/<provider>"

    Examples:
      | provider |
      | cognito  |
      | onelogin |

  # ==========================================================================
  # Signing in
  # ==========================================================================

  @integration
  Scenario Outline: Starting sign-in sends the browser to the identity provider
    Given NEXTAUTH_PROVIDER is "<provider>"
    When someone starts sign-in
    Then they are sent to the identity provider's own authorization endpoint
    And the request carries the configured client id
    And the request asks for the openid, email and profile scopes
    And the request carries the redirect URL registered for this deployment

    Examples:
      | provider |
      | cognito  |
      | onelogin |

  # A profile without a display name must not block sign-in: Cognito pools can
  # be configured without the name attribute, and OneLogin returns the fields
  # under different keys depending on how the directory is mapped.
  @unit
  Scenario Outline: A profile without a display name still yields a usable name
    Given an identity provider returns a profile with no name
    And the profile carries "<field>" as "<value>"
    When the account is created
    Then the account's display name is "<expected>"

    Examples:
      | field              | value            | expected      |
      | preferred_username | dogfood          | dogfood       |
      | username           | dogfood          | dogfood       |
      | email              | sso@example.com  | sso           |

  # ==========================================================================
  # The license gate applies exactly as it does to every other provider
  # ==========================================================================

  @unit
  Scenario Outline: Without a license the provider is not offered
    Given a deployment with no Enterprise license
    And NEXTAUTH_PROVIDER is "<provider>"
    When the deployment starts
    Then the deployment starts in email mode
    And sign-in through the identity provider is refused

    Examples:
      | provider |
      | cognito  |
      | onelogin |

  # ==========================================================================
  # Configuring it on Kubernetes
  #
  # The chart is how a self-hosted operator actually sets this, and a provider
  # the chart accepts in values but never passes to the container is indis-
  # tinguishable, from the outside, from one that is not supported at all.
  # ==========================================================================

  @integration
  Scenario Outline: Configuring a provider through the chart reaches the container
    Given the chart is rendered with provider "<provider>" and its credentials
    Then the application container receives NEXTAUTH_PROVIDER as "<provider>"
    And it receives that provider's client id, client secret and issuer
    And it receives nothing belonging to any other provider

    Examples:
      | provider |
      | cognito  |
      | onelogin |

  @integration
  Scenario: Credentials can be supplied as secret references
    Given the chart is rendered with a provider whose client secret is a secret reference
    Then the container reads that value from the referenced secret rather than the manifest

  # ==========================================================================
  # Proven against a real identity provider
  #
  # Verified by hand against a live Cognito user pool, since it needs an AWS
  # account, a hosted-UI domain and a browser. Left @unimplemented because
  # there is no CI binding for it, not because it is unverified.
  # ==========================================================================

  @e2e @unimplemented
  Scenario: Signing in against a real Cognito user pool
    Given a deployment configured against a real Cognito user pool
    When someone signs in with their Cognito credentials
    Then Cognito authenticates them and returns them to LangWatch
    And they arrive signed in to the application
    And signing in again lands them in the same account rather than a second one
