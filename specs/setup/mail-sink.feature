Feature: Local mail sink (mailsim)
  A local service that plays the outside world's mailbox, so every email the
  product sends can be caught, read and asserted on a laptop with no SendGrid
  account and nothing ever leaving the machine. haven runs it as a lane beside
  the stack, assigns each stack an inbox address of its own, and serves the
  caught messages back three ways: the `haven mail` CLI, a plain HTTP API, and
  a browser inbox at mail.<slug>.langwatch.localhost. The sink is a dead end
  by construction — it accepts any delivery and relays none, whatever the
  recipient's domain, so a test can safely address real-looking addresses.

  Background:
    Given a worktree's stack is running with the mail lane

  # --- Catching mail over SMTP -------------------------------------------

  @unit
  Scenario: A message delivered over SMTP is stored and never relayed
    When a client delivers a message over SMTP addressed to any recipient
    Then the message lands in the stack's inbox
    And nothing is forwarded anywhere, even when the recipient is a real external domain

  @unit
  Scenario: A stored message keeps everything the sender said
    When a message with a subject, a text body, an HTML body and an attachment is delivered
    Then reading it back returns the envelope sender and recipients, the headers,
      both bodies, the attachment and the time it arrived

  @unit
  Scenario: Credentials are accepted but never required
    When one client delivers with a username and password and another delivers with none
    Then both deliveries succeed
    # So a production-shaped SMTP configuration works against the sink unchanged —
    # the app never needs a special "no auth" mode to test locally.

  @unit
  Scenario: An oversized message is refused at delivery time
    When a client delivers a message larger than the sink's size limit
    Then the delivery fails with a permanent SMTP error naming the limit
    And the inbox is left as it was

  # --- The stack's own address --------------------------------------------

  @unit
  Scenario: Every stack is assigned an inbox address of its own
    Then the stack has an email address derived from the worktree's slug
    And `haven mail address` prints it, so a signup form or a script can be handed it directly

  @unit
  Scenario: Any local part at the stack's mail domain lands in the inbox
    When messages are delivered to two different local parts at the stack's mail domain
    Then both land in the stack's inbox, each remembering the exact address it was sent to
    # Catch-all on purpose: signup tests can invent user1@, user2@, admin+alias@
    # without registering anything first.

  @unit
  Scenario: Two worktrees' inboxes never mix
    Given two worktrees each running their own stack and mail lane
    When a message is delivered to the first stack's address
    Then it appears only in the first stack's inbox
    And the second stack's `haven mail list` does not show it

  # --- The stack sends its own email into the sink -------------------------

  @unit
  Scenario: A stack with the mail lane sends its email into the sink
    Given a developer who has configured no email provider
    When the stack is planned
    Then haven injects SMTP settings pointing the app at the sink
    And an email the app sends, such as a signup verification, lands in the stack's inbox

  @unit
  Scenario: A provider the developer chose explicitly is left alone
    Given a `.env` that names a real email provider
    When the stack is planned
    Then the developer's provider settings win and haven injects nothing over them
    # haven never silently rewires mail the developer deliberately routed
    # elsewhere; the sink still catches whatever is addressed to it directly.

  # --- Reading mail from the CLI -------------------------------------------

  @unit
  Scenario: The inbox lists newest first
    Given the inbox holds several messages
    When the developer runs `haven mail list`
    Then the messages are listed newest first with an id, sender, recipient, subject and arrival time

  @unit
  Scenario: One message can be read in full
    When the developer runs `haven mail get` with a message's id
    Then the output carries the headers and the text body
    And the links the message carries are listed on their own,
      so a verification or invite link can be followed without parsing HTML

  @unit
  Scenario: Asking for a message that does not exist is a refusal, not a stack trace
    When the developer runs `haven mail get` with an id the inbox does not hold
    Then the command fails saying the message is not in this stack's inbox

  @unit
  Scenario: A test can wait for a message to arrive
    When the developer runs `haven mail wait` with a recipient or subject filter
    Then the command blocks until a matching message arrives and prints it
    And it exits non-zero after its timeout with nothing matched, so a script can tell the difference

  @unit
  Scenario: The inbox can be emptied
    Given the inbox holds messages
    When the developer runs `haven mail clear`
    Then the inbox reads back empty

  @unit
  Scenario: Every mail command has a machine-readable form
    When any `haven mail` command is run with `--json` or under agent mode
    Then the output is plain and parseable, with no tables, color or spinner

  @unit
  Scenario: Reading mail with no sink running says so
    Given a stack whose mail lane is not running
    When the developer runs any `haven mail` command
    Then it fails immediately, naming the lane and the command that starts it, rather than hanging

  # --- The API --------------------------------------------------------------

  @unit
  Scenario: Everything the CLI can do, a test can do over plain HTTP
    When a client calls the sink's HTTP API to list the inbox, fetch one message and delete it
    Then each call succeeds with a JSON body
    # The CLI is a client of this same API — there is one read path, not two.

  # --- The browser inbox -----------------------------------------------------

  @unit
  Scenario: The inbox is served in the browser at the stack's mail hostname
    When the developer opens the stack's mail hostname
    Then the inbox lists the caught messages
    And opening one renders its HTML body

  @unit
  Scenario: Every response the sink serves carries the standard security headers
    When any page or API response is served
    Then it declares its content type may not be sniffed
    And it refuses to be framed by any other page
    And it sends no referrer
    And API responses are marked never to be cached

  @unit
  Scenario: A caught message's HTML is rendered inert
    When a message's HTML body is viewed in the browser inbox
    Then it renders inside a sandboxed frame whose policy blocks scripts and external requests
    # A caught email is untrusted input: a hostile or tracking-laden message
    # must not run script in the developer's browser or phone home that it
    # was opened.

  # The reported defect: you cannot click the link. A bare sandbox token blocks
  # popups and top-level navigation as well as scripts, so every anchor in the
  # preview was inert — and following the link is the reason the mail was
  # caught. The plain-text tab had the same problem for a different reason:
  # a URL printed as characters is one you have to select and paste.

  @unit
  Scenario: A link in a caught message can be opened
    Given a caught message whose HTML body contains a sign-in link
    When it is viewed in the browser inbox
    Then the link opens in a new tab, while scripts, forms and same-origin access stay refused
    And a link written with escaped ampersands is listed as the address the email meant
    And a message that declares its own base is left as the sender wrote it

  @unit
  Scenario: The inbox can tell you a message arrived without you watching it
    Given the inbox open in a background tab while the application is used in another
    When desktop notifications are switched on from the inbox toolbar
    Then a message arriving raises a notification that opens it
    And permission is asked for only when the toggle is pressed, never on load

  @unit
  Scenario: URLs in a plain-text body are links, not characters to copy
    Given a caught message whose plain-text body contains a URL in a sentence
    When the plain-text tab is read
    Then the URL is a link and the sentence's punctuation is not part of it
    And a body containing markup is still shown as the text it is

  # --- Seeding ---------------------------------------------------------------

  @unit
  Scenario: The seeded identity keeps one address everywhere
    When the developer runs `haven db seed` in any worktree
    Then the seeded user's address is the same stable one on every worktree
    # A saved login (a password manager entry) keeps working across worktrees
    # and reseeds. Nothing about the address varies by stack.

  @unit @unimplemented
  Scenario: Email to the seeded identity lands in the stack that sent it
    Given two worktrees' stacks seeded with the same admin address
    When each stack's app emails its own admin
    Then each message lands in its own stack's inbox
    # Isolation comes from which sink caught the message, never from the
    # address: each stack sends through its own sink, and the sink is a
    # catch-all, so a global address needs no per-stack rewriting.

  @unit @unimplemented
  Scenario: Every account a preset seeds is reachable through the sink
    When a preset seeds additional members
    Then an invite the app sends any of them lands in the stack's inbox
    And can be read back with `haven mail`

  @unit
  Scenario: Per-stack seed addresses remain available on ask
    Given a developer who sets the seed email domain explicitly
    When the database is seeded
    Then every seeded account's address moves to that domain, local parts unchanged
    And leaving it unset seeds the stable global addresses

  @unit
  Scenario: A database seeded before the address rename reseeds onto the new one
    Given a database whose admin was seeded under the previous default address
    When the developer reseeds
    Then the same admin account carries the new address and no second admin exists
    # The seeded default moved once, to admin@mail.langwatch.localhost. A
    # reseed updates the existing account in place; duplicating the admin
    # would break every saved login and every open session.

  @unit
  Scenario: Reseeding keeps the seeded addresses stable
    Given a stack seeded once
    When the developer runs `haven db seed` again
    Then the seeded accounts keep the same addresses, so no duplicate users appear

  # --- haven integration ------------------------------------------------------

  @unit
  Scenario: The mail lane runs by default and can be turned off per worktree
    Given a fresh worktree
    Then haven's default selection runs the mail lane
    And `haven up -mail` turns the lane off for that worktree

  @unit
  Scenario: The sink appears in haven status like any other lane
    When the developer runs `haven status`
    Then the mail lane is listed with its health, its SMTP address and its browser hostname

  @unit
  Scenario: The inbox survives a stack restart
    Given the inbox holds messages
    When the stack is restarted
    Then the messages are still there
    # An agent restarting the backend mid-test must not lose the email it was
    # about to assert on. The inbox empties only on `haven mail clear` or when
    # the worktree's stack state is pruned.
