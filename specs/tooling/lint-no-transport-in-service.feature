Feature: The no-transport-in-service lint rule
  A service decides; it does not speak a wire protocol. A raw Node request or
  response in a service ties the decision to one transport, so the decision
  cannot be tested without a socket or reused by another transport. The
  transport that received the exchange reads the request and writes the
  response.

  Background:
    Given a workspace whose agent module has a process half

  @unit
  Scenario: A service may not name the HTTP wire
    Given a file under services/ that imports node:http, https or IncomingMessage and ServerResponse
    When the no-transport-in-service rule runs over it
    Then it reports transportInService once per import, on its line

  @unit
  Scenario: The report says how the service answers instead
    Given a file under services/ that imports IncomingMessage
    When the no-transport-in-service rule runs over it
    Then the message asks the service to take plain values and answer plain values

  @unit
  Scenario: A service may not write the response
    Given a file under services/ that calls res.writeHead
    When the no-transport-in-service rule runs over it
    Then it reports writesTheResponse on the call

  @unit
  Scenario: A service may not build a Fetch Response
    Given a file under services/ that calls new Response, Response.json, Response.redirect or Response.error
    When the no-transport-in-service rule runs over it
    Then it reports buildsTheResponse on each, naming the shape
    And the fix asks for a discriminated answer a door in transport/ turns into the Response

  @unit
  Scenario: A Response the service imports under that name is not the Fetch one
    Given a file under services/ that imports its own binding named Response
    When the no-transport-in-service rule runs over it
    Then it reports nothing for new Response or Response.json

  # A response, for the write shapes, is told by name and annotation only, and
  # the test leans to missing one rather than flagging a stream: the receiver
  # is named res, resp, response or reply, or ends in Response or Res in camel
  # case, or is a binding in the file annotated ServerResponse, OutgoingMessage,
  # Http2ServerResponse or Response.
  @unit
  Scenario: A service may not set the status, headers or body of a response
    Given a file under services/ that assigns res.statusCode, or calls setHeader, write or end on a response
    When the no-transport-in-service rule runs over it
    Then it reports writesTheResponse on each, naming the shape

  @unit
  Scenario: A stream or an error with the same method names is not a response
    Given a file under services/ that calls write and end on a stream or socket and assigns statusCode on an error
    When the no-transport-in-service rule runs over it
    Then it reports nothing

  @unit
  Scenario: A transport and a test may name the wire
    Given the same imports, writes and Response builds in a transport file and in a service test
    When the no-transport-in-service rule runs over them
    Then it reports nothing
