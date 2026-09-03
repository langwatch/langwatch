# Five lanes, five log formats. `pnpm dev` interleaves Vite, two Node
# applications, two Go services and a vendored ClickHouse driver in one
# terminal, and each printed its own idea of a log line: a 12-hour clock with
# no milliseconds, a full ISO date, a bracketed date-and-scope, a ` > `
# separator, and a constant field trio repeated on every single line. Reading
# down the column was impossible, which is the only way a developer reads a
# five-lane terminal.
#
# `concurrently` already prefixes every line with the lane it came from — [ui],
# [api], [workers], [gateway], [nlpgo] — so the lane name, the process
# identity and the deployment environment are all said once, by the prefix. A
# lane repeating them is spending the width a message needs.
#
# The shape, for every lane:
#
#   [HH:mm:ss.SSS] LEVEL (scope): message <its fields>
#
# No date (a dev terminal is always today), no lane name, no field that is the
# same on every line. The scope is the logger's own name where a lane has one.
#
# The shape is pino-pretty's, and that is not an aesthetic preference: a
# transport target's options cross a worker-thread boundary and are
# structured-cloned, so the console cannot be handed a custom prettifier for
# the time or the level. Building the pretty stream on the main thread instead
# gets around that and silently kills the OpenTelemetry log transport, whose
# worker only survives while it is pino's own destination rather than one leg
# of a multistream. So the lanes that CAN be shaped freely — the dev server and
# the Go services — are shaped to match the one that cannot.

Feature: One log format across every dev lane
  As a developer reading five lanes in one terminal
  I want every line to have the same shape
  So that I can scan a column instead of parsing five formats

  # --- The Node lanes ---

  @unit
  Scenario: A Node lane prints a time, a level, a scope and a message
    Given a Node lane logging in a development terminal
    When it writes a line
    Then the time is the time of day to the millisecond, with no date
    And the level is a whole word
    And the logger's scope is what names the line, not the process

  # The server context is stamped onto every record by a mixin, and outside a
  # request every one of its fields is null. Printed, that is fifty columns of
  # `traceId=null spanId=null organizationId=null projectId=null userId=null`
  # on every boot line, ahead of the message.
  @unit
  Scenario: Context that is not there is not printed
    Given a line logged outside any request
    When it is written to the console
    Then the empty request and tenant context is left off

  @unit
  Scenario: Context that is there is printed
    Given a line logged while serving a request
    When it is written to the console
    Then the identifiers it carries are on it

  # --- The Vite lane ---

  @unit
  Scenario: The dev server prints the same shape as everything else
    Given the browser application's dev server logging
    When it writes a line
    Then it reads as a bracketed time, a level, the scope "vite" and a message
    And no twelve-hour clock and no "[vite]" tag are on it

  @unit
  Scenario: What the browser reports through the dev server still arrives
    Given the browser relaying an error through the dev server
    When the dev server writes it
    Then the relay is still readable as one line

  # --- The proxy is a lane, not a stack trace ---

  # With the api lane down, every single request the browser made produced a
  # multi-line AggregateError from the proxy. One boot with the api lane failing
  # to bind filled the terminal with them, and the one line saying WHY the api
  # lane was down was the first casualty.
  @unit
  Scenario: An unreachable API is one line, not a stack trace per request
    Given the api lane is not listening
    When the browser makes many requests through the dev server
    Then the developer is told once where it tried and could not reach
    And it is a single line

  @unit
  Scenario: A proxy that stays down says so again after a while
    Given the api lane has been unreachable for some time
    When another request fails
    Then it is reported again, so a stack that never came up is not silent forever

  # --- The Go lanes ---

  @unit
  Scenario: A Go service prints the same shape as the Node lanes
    Given a Go service logging to a development terminal
    When it writes a line
    Then it is a bracketed time, a level, a message and its key-value pairs
    And no separator sits between the message and its fields

  @unit
  Scenario: The constant service identity is not repeated on every line
    Given a Go service whose identity is fixed for the life of the process
    When it writes a line to the console
    Then the environment, service name and version are not on it
    And a machine-readable line still carries them, because nothing prefixes those

  # --- The vendored driver ---

  # `@clickhouse/client` writes its own console lines, with its own bracketed
  # ISO-date format and its own idea of a level. A driver error read as if it
  # came from somewhere else entirely.
  # The seam for this existed and nothing was plugged into it: the policy that
  # decides what a driver record means, and the option that carries a logger
  # class down to the driver, were both written and neither was ever passed a
  # value, so the driver went on writing its own console lines.
  @unit
  Scenario: The database driver logs through the process's own logger
    Given the ClickHouse driver reporting a connection problem
    When it writes it
    Then it goes through the logger the process composed, not the driver's own console

  @unit
  Scenario: A driver record keeps the level the policy gives it
    Given the ClickHouse driver reporting at each of its levels
    When each is written
    Then an informational record is informational and a warning is a warning
    And the driver's own error is dropped, because only the wrapper around the call knows whether it was retried
