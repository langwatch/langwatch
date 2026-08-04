Feature: Email gateway providers
  As an operator self-hosting LangWatch
  I want to send notification emails through whichever gateway my network allows
  So that alerts, invites and reports reach users without opening direct egress to a single vendor

  # Corporate deployments commonly reach the internet only through an HTTP proxy,
  # or are only allowed to relay mail through an internal SMTP server. Supporting
  # a single hardcoded vendor leaves those deployments with no working email at all.

  Background:
    Given the application sends email through the shared mailer

  @unit
  Scenario: Operator picks a provider explicitly
    Given the email provider is set to "smtp"
    And SMTP connection settings are configured
    When the application sends an email
    Then the message is delivered through the SMTP relay

  @unit
  Scenario Outline: Every supported gateway can be selected
    Given the email provider is set to "<provider>"
    And credentials for "<provider>" are configured
    When the application sends an email
    Then the message is delivered through "<provider>"

    Examples:
      | provider |
      | ses      |
      | sendgrid |
      | smtp     |
      | resend   |

  @unit
  Scenario: Existing deployments keep working without naming a provider
    Given no email provider is named
    And only a SendGrid API key is configured
    When the application sends an email
    Then the message is delivered through SendGrid

  @unit
  Scenario: Existing AWS deployments keep working without naming a provider
    Given no email provider is named
    And AWS SES is enabled with a region
    When the application sends an email
    Then the message is delivered through SES

  @unit
  Scenario: A named provider wins over inferred credentials
    Given the email provider is set to "smtp"
    And SMTP connection settings are configured
    And a SendGrid API key is also configured
    When the application sends an email
    Then the message is delivered through the SMTP relay

  @unit
  Scenario: An unknown provider name is rejected loudly
    Given the email provider is set to "carrier-pigeon"
    When the application sends an email
    Then sending fails with an error naming the supported providers

  @unit
  Scenario: A named provider missing its credentials is rejected loudly
    Given the email provider is set to "resend"
    And no Resend API key is configured
    When the application sends an email
    Then sending fails with an error explaining which setting is missing

  @unit
  Scenario: No email configuration at all is reported clearly
    Given no email provider is named
    And no email credentials are configured
    When the application sends an email
    Then sending fails with an error saying no email method is available

  @unit
  Scenario Outline: The full message surface survives every gateway
    Given the email provider is set to "<provider>"
    When the application sends an email with attachments, blind copies, a reply-to address and custom headers
    Then the recipient receives the attachments and custom headers
    And blind copied recipients are not revealed to the other recipients

    Examples:
      | provider |
      | ses      |
      | smtp     |
      | resend   |

  @unit
  Scenario: An attachment named in a non-English alphabet keeps its name
    Given the email provider is set to "ses"
    When the application sends an email with an attachment whose filename contains accented characters
    Then the recipient sees the accented filename
    And a plain-ASCII filename is also present for receivers that cannot read the accented form

  @unit
  Scenario: Email egress follows the configured outbound proxy
    Given an outbound HTTP proxy is configured for the environment
    And the email provider is set to "ses"
    When the application sends an email
    Then the request to the gateway is routed through the proxy

  @unit
  Scenario: Hosts excluded from proxying are contacted directly
    Given an outbound HTTP proxy is configured for the environment
    And the email gateway host is listed as a proxy exception
    When the application sends an email
    Then the request to the gateway bypasses the proxy

  @unit
  Scenario: Operator overrides the SES endpoint
    Given the email provider is set to "ses"
    And a custom SES endpoint is configured
    When the application sends an email
    Then the request is sent to the custom endpoint instead of the public one

  @unit
  Scenario: Email options stay hidden when no gateway is usable
    Given no email provider can be resolved
    When an administrator invites a teammate
    Then the invitation can only be shared as a link, not sent by email

  @unit
  Scenario: Email options appear once any gateway is usable
    Given the email provider is set to "smtp"
    And SMTP connection settings are configured
    When an administrator invites a teammate
    Then the invitation can be sent by email

  @unit
  Scenario: A misconfigured gateway does not break the interface
    Given the email provider is set to a gateway that is missing its credentials
    When the interface asks whether email is available
    Then it reports email as unavailable rather than failing to render
