Feature: The subscription lane streams subscriptions and nothing else
  As a signed-in LangWatch user
  I want the live update channel to run only the procedures it exists to stream
  So that a page on another site cannot make my browser change my account

  `GET /api/sse/{procedure.path}` is opened by an `EventSource`, which carries no
  header and so authenticates with the browser session cookie. That cookie is
  `SameSite=Lax`, which a browser releases on a cross-site TOP-LEVEL navigation,
  and the tRPC caller the lane resolves a path on exposes queries, mutations and
  subscriptions as identical callable leaves. Left alone, those two facts compose
  into a live CSRF against every mutation the process serves: an attacker page
  that navigates to `/api/sse/project.regenerateApiKey?input=...` rotates the
  victim's project key. `fetchRequestHandler` refuses a mutation over GET on the
  `/api/trpc` endpoint; this lane is the same router without that refusal, so it
  needs its own.

  Two gates, both before the request's session and context are resolved: the
  request must come from this application's own pages, and the path must name a
  SUBSCRIPTION on the composed router's own procedure record — the only place a
  procedure's type still exists once a caller has been built.

  Implementation:
    - apps/api/src/app-trpc/app-trpc.sse.ts (both gates)
    - apps/api/src/api.application.ts (the procedure record the type is read off)
    - apps/api/src/api-rest.cross-site.ts (the process's one same-origin answer)

  Rule: Only a subscription is served over the lane

    @integration
    Scenario: A subscription path still streams
      Given a process whose router carries a subscription
      When a browser opens the live update channel at that path
      Then the channel opens and streams the subscription's values

    @integration
    Scenario: A mutation path on the subscription lane is refused without running
      Given a process whose router carries a mutation
      When a request opens the live update channel at that mutation's path
      Then the request is refused as unsupported on that channel
      And the mutation does not run

    @integration
    Scenario: A mutation reached over the subscription lane never runs
      Given a process whose router carries a real mutation over a service
      When a request opens the live update channel at that mutation's path
      Then the request is refused
      And the service behind the mutation is never called

    @integration
    Scenario: A query path on the subscription lane is refused
      Given a process whose router carries a query
      When a request opens the live update channel at that query's path
      Then the request is refused rather than streaming the query's single result

    @integration
    Scenario: A query reached over the subscription lane never runs
      Given a process whose router carries a real query over a service
      When a request opens the live update channel at that query's path
      Then the request is refused
      And the service behind the query is never called

    @integration
    Scenario: An unknown subscription path is refused as not found
      Given a process whose router carries no procedure at a path
      When a request opens the live update channel at that path
      Then the request is refused as not found
      And no request context or session is resolved for it

  Rule: The channel is opened by this application's own pages

    A cross-site request is refused before anything is parsed or resolved, so a
    navigation from another site costs a header read and nothing else.

    @integration
    Scenario: A cross-site request cannot open the subscription lane
      Given a signed-in person whose browser holds a session cookie
      When another site navigates their browser to the live update channel
      Then the request is refused as cross-site
      And no request context or session is resolved for it

    @integration
    Scenario: A browser that sends only an Origin still opens the channel
      Given a browser too old to send a fetch-site header
      When it opens the live update channel from the application's own origin
      Then the channel opens, because the origin matches the host it asked

    @integration
    Scenario: A request carrying no same-site signal is refused
      Given a request that carries neither a fetch-site signal nor an origin
      When it opens the live update channel
      Then the request is refused, because there is no positive same-site signal
