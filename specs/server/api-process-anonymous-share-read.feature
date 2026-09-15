Feature: The API process meters the anonymous shared-trace read
  As an operator running a LangWatch API deployment
  I want the one trace read that needs no credential to be counted against a
  real per-window budget
  So that a leaked share link cannot be turned into unbounded ClickHouse
  fan-out from outside

  # WHY THIS EXISTS
  #
  # `sharedTrace.get` is the ONLY trace read the open internet can drive. It
  # carries no credential, and every call costs five ClickHouse reads plus a
  # view write. The transport that serves it has always had the whole refusal:
  # 60 reads a minute per share token, 120 a minute per calling address, a
  # typed `share_read_rate_limited` error and the customer copy registered
  # against that code.
  #
  # What it never had on this process was the COUNTER. The composition handed
  # the transport a stand-in that answered "allowed" without counting, so the
  # refusal could not fire, and nothing said so at boot — unlike every other
  # absence this process names. The ceilings are Trace's numbers; the only
  # thing a process supplies is where they are kept.
  #
  # The address half needs one more thing: it is resolved off the request the
  # tRPC context carries, and this process used to pin that member to absent.
  # With no address the per-address ceiling silently does not apply, and the
  # hash that collapses one viewer's refreshes into a single viewing does not
  # either — so every refresh also burned a view off the link's cap.

  Rule: The read is counted before any of its reads run

    @integration
    Scenario: An anonymous share read is metered against the process's own counter
      Given the API process composed the observability collaborators
      When somebody with no session opens a shared trace link
      Then the read is counted against the share token and against the caller's address
      And the share payload is answered

    @integration
    Scenario: A share link read past its ceiling is refused with the code its copy is written for
      Given a share link has been opened its full allowance of times this minute
      When the same link is opened once more
      Then the read is refused as share_read_rate_limited before any trace read runs
      And a different share link is still answered, because each token has its own window
