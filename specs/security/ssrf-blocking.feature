Feature: SSRF blocking via BLOCK_LOCAL_HTTP_CALLS toggle (TS + Python parity)
  As a self-hosted operator or LangWatch SaaS administrator
  I want a single, explicit env var to control whether outbound HTTP calls
  to private/local networks are blocked across both the TypeScript app and
  the Python NLP service
  So that I can either reach internal services on-prem (toggle off) or
  enforce SSRF protection on multi-tenant SaaS (toggle on) without relying
  on indirect signals like NODE_ENV or IS_SAAS.

  Implementations:
    - TS: langwatch/src/utils/ssrfProtection.ts (httpProxyRouter, scenario runner)
    - Python: langwatch_nlp/langwatch_nlp/studio/execute/http_node.py

  # ============================================================================
  # Default behavior — toggle unset/false
  # ============================================================================

  Rule: When BLOCK_LOCAL_HTTP_CALLS is unset or false, local network calls succeed
    The default is permissive so on-prem operators can reach internal services
    out of the box. SaaS deployments must opt in by setting the var to true.

    @unit
    Scenario Outline: <impl> allows private IP literals when BLOCK_LOCAL_HTTP_CALLS is unset
      Given BLOCK_LOCAL_HTTP_CALLS is unset
      When <impl> validates a URL with hostname <hostname>
      Then the validation passes
      And no SSRF block error is raised

      Examples:
        | impl   | hostname    |
        | TS     | 10.0.5.3    |
        | TS     | 192.168.1.1 |
        | TS     | 127.0.0.1   |
        | TS     | localhost   |
        | Python | 10.0.5.3    |
        | Python | 192.168.1.1 |
        | Python | 127.0.0.1   |
        | Python | localhost   |

    @unit
    Scenario Outline: <impl> allows private IP literals when BLOCK_LOCAL_HTTP_CALLS is "false"
      Given BLOCK_LOCAL_HTTP_CALLS is "false"
      When <impl> validates a URL with hostname 10.0.0.5
      Then the validation passes

      Examples:
        | impl   |
        | TS     |
        | Python |

  # ============================================================================
  # Enabled behavior — toggle true
  # ============================================================================

  Rule: When BLOCK_LOCAL_HTTP_CALLS is true, local network calls are blocked
    Both implementations block private IPv4, IPv6, loopback, link-local, and
    hostnames that DNS-resolve to those ranges.

    @unit
    Scenario Outline: <impl> blocks private IP literals when BLOCK_LOCAL_HTTP_CALLS is "true"
      Given BLOCK_LOCAL_HTTP_CALLS is "true"
      And ALLOWED_PROXY_HOSTS is empty
      When <impl> validates a URL with hostname <hostname>
      Then the validation fails with an SSRF block error

      Examples:
        | impl   | hostname    |
        | TS     | 127.0.0.1   |
        | TS     | 10.0.5.3    |
        | TS     | 192.168.1.1 |
        | TS     | 0.0.0.0     |
        | TS     | localhost   |
        | TS     | ::1         |
        | Python | 127.0.0.1   |
        | Python | 10.0.5.3    |
        | Python | 192.168.1.1 |
        | Python | 0.0.0.0     |
        | Python | localhost   |
        | Python | ::1         |

    @unit
    Scenario Outline: <impl> blocks DNS rebinding to private IPs when BLOCK_LOCAL_HTTP_CALLS is "true"
      Given BLOCK_LOCAL_HTTP_CALLS is "true"
      And the hostname "internal.example.com" resolves to 10.0.5.3
      When <impl> validates "http://internal.example.com/"
      Then the validation fails with an SSRF block error

      Examples:
        | impl   |
        | TS     |
        | Python |

  # ============================================================================
  # Allowlist — same semantics on both sides
  # ============================================================================

  Rule: ALLOWED_PROXY_HOSTS is a literal hostname allowlist evaluated regardless of NODE_ENV
    Match is case-insensitive on hostname only (port is ignored). Matches bypass
    private-IP/localhost checks. Cloud metadata is NEVER bypassed.

    @unit
    Scenario Outline: <impl> allows allowlisted host even when BLOCK_LOCAL_HTTP_CALLS is "true"
      Given BLOCK_LOCAL_HTTP_CALLS is "true"
      And ALLOWED_PROXY_HOSTS is "10.0.5.3,internal.example.com"
      When <impl> validates a URL with hostname 10.0.5.3
      Then the validation passes

      Examples:
        | impl   |
        | TS     |
        | Python |

    @unit
    Scenario Outline: <impl> allowlist works in production NODE_ENV
      Given NODE_ENV is "production"
      And BLOCK_LOCAL_HTTP_CALLS is "true"
      And ALLOWED_PROXY_HOSTS is "10.0.5.3"
      When <impl> validates "http://10.0.5.3/api"
      Then the validation passes

      Examples:
        | impl   |
        | TS     |
        | Python |

    @unit
    Scenario Outline: <impl> hostname not in allowlist is still blocked
      Given BLOCK_LOCAL_HTTP_CALLS is "true"
      And ALLOWED_PROXY_HOSTS is "10.0.5.3"
      When <impl> validates "http://10.0.5.4/"
      Then the validation fails with an SSRF block error

      Examples:
        | impl   |
        | TS     |
        | Python |

  # ============================================================================
  # Cloud metadata — ALWAYS blocked, no escape
  # ============================================================================

  Rule: Cloud metadata endpoints are always blocked, regardless of toggle or allowlist
    These endpoints expose IAM credentials and are never legitimately needed by
    user workflows. Both implementations refuse them unconditionally.

    @unit
    Scenario Outline: <impl> blocks cloud metadata even when BLOCK_LOCAL_HTTP_CALLS is "false"
      Given BLOCK_LOCAL_HTTP_CALLS is "false"
      When <impl> validates a URL with hostname <metadata_host>
      Then the validation fails with a metadata security error

      Examples:
        | impl   | metadata_host           |
        | TS     | 169.254.169.254         |
        | TS     | metadata.google.internal |
        | Python | 169.254.169.254         |
        | Python | metadata.google.internal |

    @unit
    Scenario Outline: <impl> blocks cloud metadata even when host is in ALLOWED_PROXY_HOSTS
      Given BLOCK_LOCAL_HTTP_CALLS is "true"
      And ALLOWED_PROXY_HOSTS contains "169.254.169.254"
      When <impl> validates "http://169.254.169.254/latest/meta-data/"
      Then the validation fails with a metadata security error

      Examples:
        | impl   |
        | TS     |
        | Python |

  # ============================================================================
  # Migration — IS_SAAS no longer drives SSRF blocking
  # ============================================================================

  Rule: IS_SAAS does not influence SSRF blocking
    IS_SAAS continues to control license enforcement, billing, and TLS
    self-signed-cert behavior, but it no longer gates private-IP blocking.
    Operators must set BLOCK_LOCAL_HTTP_CALLS explicitly.

    @unit
    Scenario: TS validator ignores IS_SAAS for SSRF blocking
      Given IS_SAAS is "true"
      And BLOCK_LOCAL_HTTP_CALLS is unset
      When the TS validator processes "http://10.0.5.3/"
      Then the validation passes
      And no SSRF block error is raised

    @unit
    Scenario: TS validator with explicit BLOCK_LOCAL_HTTP_CALLS overrides any IS_SAAS state
      Given IS_SAAS is "false"
      And BLOCK_LOCAL_HTTP_CALLS is "true"
      When the TS validator processes "http://10.0.5.3/"
      Then the validation fails with an SSRF block error
