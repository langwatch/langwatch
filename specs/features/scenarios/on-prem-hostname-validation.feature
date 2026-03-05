Feature: On-prem hostname validation bypass for scenario runner
  As an on-prem operator
  I want scenarios to reach internal hostnames and self-signed HTTPS services
  So that I can run evaluations against agents hosted on my private network

  # --- Private hostname validation depends on IS_SAAS ---
  @unit
  Scenario: Scenario runner reaches a private hostname when IS_SAAS is false
    Given IS_SAAS is false
    When the scenario runner validates a URL with a private hostname
    Then the validation passes

  @unit
  Scenario: Scenario runner blocks a private hostname when IS_SAAS is true
    Given IS_SAAS is true
    When the scenario runner validates a URL with a private hostname
    Then the validation fails with an SSRF error

  # --- Self-signed TLS behavior depends on IS_SAAS ---
  @unit
  Scenario: Scenario runner allows self-signed certificates when IS_SAAS is false
    Given IS_SAAS is false
    When the scenario runner builds a fetch request
    Then TLS certificate validation is disabled

  @unit
  Scenario: Scenario runner enforces TLS certificates when IS_SAAS is true
    Given IS_SAAS is true
    When the scenario runner builds a fetch request
    Then TLS certificate validation is enabled

  # --- Cloud metadata always blocked, even on-prem ---
  @unit
  Scenario Outline: Cloud metadata endpoints are blocked even when IS_SAAS is <saas_value>
    Given IS_SAAS is <saas_value>
    When the scenario runner validates a cloud metadata endpoint
    Then the validation fails with a metadata security error

    Examples:
      | saas_value |
      | true       |
      | false      |

  # --- Cloud internal domains always blocked ---
  @unit
  Scenario Outline: Cloud provider internal domains are blocked even when IS_SAAS is <saas_value>
    Given IS_SAAS is <saas_value>
    When the scenario runner validates a cloud provider internal domain
    Then the validation fails with a cloud domain security error

    Examples:
      | saas_value |
      | true       |
      | false      |

  # --- Private IP literals ---
  @unit
  Scenario: Private IP literals are allowed when IS_SAAS is false
    Given IS_SAAS is false
    When the scenario runner validates a private IP literal like 10.0.0.5
    Then the validation passes

  @unit
  Scenario: Private IP literals are blocked when IS_SAAS is true
    Given IS_SAAS is true
    When the scenario runner validates a private IP literal like 10.0.0.5
    Then the validation fails with an SSRF error
