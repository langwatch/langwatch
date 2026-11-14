Feature: The client address comes only from hops the operator declared
  As an operator running LangWatch behind a CDN, a load balancer or an ingress
  I want the caller's address read from a forwarding header only when the
  request reached the process through a proxy I named in configuration
  So that a caller reaching the load balancer directly cannot choose the
  address its rate limits, audit rows and sign-in throttles are keyed on.

  A private socket peer proves nothing: a load balancer that rewrites the
  source address presents every caller as a private node address. Trust is
  TRUSTED_PROXY_ADDRESSES (addresses or IPv4/IPv6 CIDR ranges) and, for
  Cloudflare's header, TRUST_CLOUDFLARE_CLIENT_IP on top of it. The chain
  rules already covered by specs/security/api-spine-hardening.feature (an
  untrusted peer's header is ignored, a trusted chain resolves to the
  rightmost hop it did not write) still hold and are not repeated here.

  Rule: Cloudflare's header is honoured only from a declared Cloudflare peer

    @unit
    Scenario: A trusted Cloudflare peer with the flag on names the caller
      Given the trusted proxy addresses are the Cloudflare ranges
      And TRUST_CLOUDFLARE_CLIENT_IP is on
      When a request arrives from a Cloudflare edge address carrying CF-Connecting-IP
      Then the resolved client address is the address CF-Connecting-IP names

    @unit
    Scenario: A direct caller behind a source-rewriting load balancer cannot forge its address
      Given the trusted proxy addresses are the Cloudflare ranges
      And TRUST_CLOUDFLARE_CLIENT_IP is on
      When a request arrives from a private node address outside the trusted set
      And it carries a forged CF-Connecting-IP and a forged X-Forwarded-For
      Then the resolved client address is the socket address

    @unit
    Scenario: The flag on does not honour CF-Connecting-IP from a peer outside the trusted set
      Given the trusted proxy addresses are the Cloudflare ranges
      And TRUST_CLOUDFLARE_CLIENT_IP is on
      When a request arrives from a public address outside the trusted set carrying CF-Connecting-IP
      Then the resolved client address is the socket address

    @unit
    Scenario: The flag off ignores CF-Connecting-IP even from a trusted peer
      Given the trusted proxy addresses are the Cloudflare ranges
      And TRUST_CLOUDFLARE_CLIENT_IP is off
      When a request arrives from a Cloudflare edge address carrying CF-Connecting-IP and no X-Forwarded-For
      Then the resolved client address is the socket address

    @unit
    Scenario: A list or junk in CF-Connecting-IP falls through to the forwarded chain
      Given the trusted proxy addresses are the Cloudflare ranges
      And TRUST_CLOUDFLARE_CLIENT_IP is on
      When a trusted peer sends CF-Connecting-IP holding a list or a word, and an X-Forwarded-For chain
      Then CF-Connecting-IP is ignored
      And the resolved client address is the rightmost forwarded hop outside the trusted set

    @unit
    Scenario: TRUST_CLOUDFLARE_CLIENT_IP with no trusted proxy addresses refuses to boot
      Given TRUST_CLOUDFLARE_CLIENT_IP is on
      And TRUSTED_PROXY_ADDRESSES is unset or empty
      When the API process reads its configuration
      Then it refuses to start with a configuration error naming both settings

    @unit
    Scenario: An unreadable trusted proxy entry refuses to boot
      Given TRUSTED_PROXY_ADDRESSES names a hostname or a malformed range
      When the API process reads its configuration
      Then it refuses to start with a configuration error naming the entry

  Rule: with no trusted set, the socket is the client and no header is read

    @unit
    Scenario: A private peer is not trusted by default
      Given no trusted proxy addresses are configured
      When a request arrives from a private address carrying X-Forwarded-For, X-Real-IP and True-Client-IP
      Then the resolved client address is the socket address

    @unit
    Scenario: Vendor headers other than the forwarded chain are never read
      Given the request's socket address is a configured trusted proxy
      When the request carries X-Real-IP and True-Client-IP but no X-Forwarded-For
      Then the resolved client address is the socket address

  Rule: the trusted set accepts IPv6 ranges

    @unit
    Scenario: A peer inside a trusted IPv6 range is a declared hop
      Given the trusted proxy addresses include an IPv6 CIDR range
      When a request arrives from an IPv6 address inside that range carrying X-Forwarded-For
      Then the resolved client address is the rightmost forwarded hop outside the trusted set
      And a peer outside the range has its forwarded header ignored

    @unit
    Scenario: A resolved address has one spelling
      Given a peer that is not a trusted hop
      When its address is written in upper case, or as an IPv4 address carried in IPv6
      Then the resolved address is lower case, and the IPv4 address unmapped
      And an IPv6 address that only looks mapped stays IPv6

  Rule: every reader uses the address the door resolved

    Each surface that keys a limit or records a caller reads the one
    resolved address, so a forged header reaches none of them.

    @unit
    Scenario: A raw door ahead of the router reads the resolved address
      Given a request a raw HTTP door answers before the router
      When the door resolves the caller's address
      Then it is the address the process resolved, not a forwarding header

    @unit
    Scenario: A rewritten OTLP request keeps the caller's resolved address
      Given an OTLP request on a misconfigured exporter path whose caller was resolved
      When the path is rewritten onto the canonical OTLP route
      Then the rewritten request carries the same resolved address

    @unit
    Scenario: Hosted MCP ignores a forged CF-Connecting-IP
      Given a hosted MCP request carrying a forged CF-Connecting-IP and X-Forwarded-For
      When its auth-failure limit keys the caller
      Then the key is the resolved client address

    @unit
    Scenario: The legacy token check counts the resolved address
      Given a legacy project token check carrying a forged X-Forwarded-For
      When its rate limit keys the caller
      Then the key is the resolved client address

    @unit
    Scenario: The bug-report intake counts the resolved address
      Given a bug report carrying a forged X-Forwarded-For
      When the intake keys the caller
      Then the key is the resolved client address

    @unit
    Scenario: Browser telemetry ingest counts the resolved address
      Given a browser trace export with no session carrying a forged X-Forwarded-For
      When the ingest door keys the caller
      Then the key is the resolved client address

    @unit
    Scenario: Governance ingest throttles on the resolved address
      Given a governance ingest request carrying a forged X-Forwarded-For
      When the ingest throttle keys the caller
      Then the key is the resolved client address

    @unit
    Scenario: The usage-report receiver limits on the resolved address
      Given a usage report carrying a forged CF-Connecting-IP
      When the receiver applies its per-address limit
      Then the limit is keyed on the resolved client address

    @unit
    Scenario: Currency detection looks up the resolved address
      Given a currency request with no country header carrying a forged CF-Connecting-IP
      When the currency is detected
      Then the address looked up is the resolved client address

    @unit
    Scenario: Authentication diagnostics record the resolved address
      Given a request the OTLP ingest door refuses
      When the door collects its diagnostics
      Then the logged address is the resolved client address, not a forwarding header
