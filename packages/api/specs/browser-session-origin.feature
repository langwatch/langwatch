# The same-origin guard on every browser-credential write (packages/api/src/rest/browser-session.ts).
# It matches main's cookie-authenticated upload guard: Sec-Fetch-Site first, then the Origin.
Feature: A browser-session write is accepted only from this deployment's own pages
  A browser attaches the session cookie to a forged cross-site request too, so a browser-credential
  write must prove it came from our own pages. A proxy in front of the API hides the public address
  from the request's own URL, so the comparison also admits the deployment's configured base host.

  Rule: A write from the deployment's own pages is accepted, whatever proxy sits in front

    @unit
    Scenario: A same-origin write through a proxy is accepted
      Given the deployment's public base host is configured
      And the API sees the request at its internal address behind a proxy
      When a signed-in browser writes with an Origin naming the public base host, or marks it Sec-Fetch-Site same-origin
      Then the session is read and the caller is identified

  Rule: A signed-in write that does not prove it came from our own pages is refused

    @unit
    Scenario: A write from a foreign origin is refused
      Given the deployment's public base host is configured
      When a browser writes with an Origin naming another site, or marks it Sec-Fetch-Site cross-site
      Then it is refused with 403 and the code cross_origin_refused
      And a foreign write carrying no session is answered as nobody, 401 where a session is required

    @unit
    Scenario: A write carrying neither an Origin nor a Referer is refused
      Given a write with no Sec-Fetch-Site, no Origin and no Referer
      When it reaches the browser-session door
      Then it is refused with 403 and the code cross_origin_refused
