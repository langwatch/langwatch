Feature: SSRF blocking via BLOCK_LOCAL_HTTP_CALLS toggle (TS + Go parity)
  As a self-hosted operator or LangWatch SaaS administrator
  I want a single, explicit env var to control whether outbound HTTP calls
  to private/local networks are blocked across both the TypeScript app and
  the Go NLP engine
  So that I can either reach internal services on-prem (toggle off) or
  enforce SSRF protection on multi-tenant SaaS (toggle on) without relying
  on indirect signals like NODE_ENV or IS_SAAS.

  The toggle is only worth having if every egress path reads it. The Go engine
  refused private addresses unconditionally for a while, ignoring the variable
  its own config declared, which is how a self-hosted install could permit an
  internal endpoint everywhere except the one path that actually runs agents.

  Implementations:
    - TS: packages/ssrf/src/index.ts (scenario runner, webhooks)
    - Go: services/nlpgo/app/engine/blocks/httpblock/ssrf.go (workflow HTTP
      nodes, which is what an HTTP agent runs as, and remote attachments)

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
        | Go     | 10.0.5.3    |
        | Go     | 192.168.1.1 |
        | Go     | 127.0.0.1   |
        | Go     | localhost   |

    @unit
    Scenario Outline: <impl> allows private IP literals when BLOCK_LOCAL_HTTP_CALLS is "false"
      Given BLOCK_LOCAL_HTTP_CALLS is "false"
      When <impl> validates a URL with hostname 10.0.0.5
      Then the validation passes

      Examples:
        | impl   |
        | TS     |
        | Go     |

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
        | Go     | 127.0.0.1   |
        | Go     | 10.0.5.3    |
        | Go     | 192.168.1.1 |
        | Go     | 0.0.0.0     |
        | Go     | localhost   |
        | Go     | ::1         |

    @unit
    Scenario Outline: <impl> blocks DNS rebinding to private IPs when BLOCK_LOCAL_HTTP_CALLS is "true"
      Given BLOCK_LOCAL_HTTP_CALLS is "true"
      And the hostname "internal.example.com" resolves to 10.0.5.3
      When <impl> validates "http://internal.example.com/"
      Then the validation fails with an SSRF block error

      Examples:
        | impl   |
        | TS     |
        | Go     |

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
        | Go     |

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
        | Go     |

    @unit
    Scenario Outline: <impl> hostname not in allowlist is still blocked
      Given BLOCK_LOCAL_HTTP_CALLS is "true"
      And ALLOWED_PROXY_HOSTS is "10.0.5.3"
      When <impl> validates "http://10.0.5.4/"
      Then the validation fails with an SSRF block error

      Examples:
        | impl   |
        | TS     |
        | Go     |

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
        | Go     | 169.254.169.254         |
        | Go     | metadata.google.internal |

    @unit
    Scenario Outline: <impl> blocks cloud metadata even when host is in ALLOWED_PROXY_HOSTS
      Given BLOCK_LOCAL_HTTP_CALLS is "true"
      And ALLOWED_PROXY_HOSTS contains "169.254.169.254"
      When <impl> validates "http://169.254.169.254/latest/meta-data/"
      Then the validation fails with a metadata security error

      Examples:
        | impl   |
        | TS     |
        | Go     |

  Rule: The metadata refusal reads the address, not the spelling of the host
    A hostname match is not a metadata check: a name an attacker controls can
    answer with the metadata address, and a bracketed IPv6 literal is a spelling
    no name list contains. The refusal is decided on the address the connection
    would actually be made to, and it is never conditioned on
    BLOCK_LOCAL_HTTP_CALLS.

    @unit
    Scenario: A hostname that resolves to the metadata address is refused with local calls allowed
      Given BLOCK_LOCAL_HTTP_CALLS is "false"
      And the hostname "imds.attacker.example" resolves to the cloud metadata address
      When the TS validator processes "http://imds.attacker.example/latest/meta-data/"
      Then the validation fails with a metadata security error

    @unit
    Scenario: A bracketed IPv6 metadata literal is refused with local calls allowed
      Given BLOCK_LOCAL_HTTP_CALLS is "false"
      When the TS validator processes a URL whose host is a bracketed IPv6 spelling
        of a metadata address
      Then the validation fails with a metadata security error

    @unit
    Scenario: A bracketed IPv6 private literal is judged as the address it is
      Given BLOCK_LOCAL_HTTP_CALLS is "true"
      When the TS validator processes a URL whose host is a bracketed IPv6
        loopback, unique-local or link-local literal
      Then the validation fails with an SSRF block error naming a private address
      And no DNS lookup was attempted for it

    @unit
    Scenario: An admitted bracketed IPv6 host keeps its brackets for the request
      Given BLOCK_LOCAL_HTTP_CALLS is "true"
      When the TS validator processes a URL whose host is a bracketed public IPv6
        literal
      Then the validation passes
      And the destination is pinned to that address with the brackets kept for the
        request line and Host header

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
