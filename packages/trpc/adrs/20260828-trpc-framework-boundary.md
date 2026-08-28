# tRPC framework boundary

**Date:** 2026-08-28

**Status:** Proposed

## Decision

`@langwatch/trpc` owns generic typed tRPC root construction **and the policy
spine every procedure runs through**: tracing, request logging, handled-error
translation, the scope-lineage guard, the declared authorization check, the
fail-closed backstop that proves a check ran, the audit trail and its
redaction rules, and the builder that makes an authorization declaration
mandatory by construction.

It still chooses none of the concretes. It depends only on `@trpc/server`,
`@langwatch/authz-contract`, `@langwatch/handled-error`,
`@langwatch/observability` and the OpenTelemetry API, and imports no
application, no ORM and no feature module. Everything a process must decide
arrives as a port it fills:

| Port                          | What the process decides                                     |
| ----------------------------- | ------------------------------------------------------------ |
| `TrpcIdentityPort`            | who the caller is, and what an authenticated context looks like |
| `TrpcAuthorizationPort`       | which composed authorization service answers, per request     |
| `TrpcAuthorizationDenialPort` | which handled errors the two role-shaped refusals carry       |
| `TrpcAuditPort`               | where an audit row is written                                 |
| `TrpcErrorReportingPort`      | which reporter an unhandled fault reaches                     |
| `TrpcCauseTranslationPort`    | which application error classes become a bad request          |
| `TrpcErrorCausePayloadPort`   | which typed causes a browser interceptor renders              |

AuthZ continues to own authorization declarations and decisions; this package
owns only the tRPC adapter around them.

## Why the spine moved

The middlewares were built on the application's own tRPC root and imported
from `platform/app`. Every transport moved out of that application therefore
had to import back into it for its policy, which made each successful
extraction grow the tree the extraction programme exists to delete. Moving the
spine behind ports is what lets a process outside `platform/app` mount a
package-owned router with the same chain.

## What must not change

Order is behaviour. The chain is tracer, logger, handled-error, scope-lineage
guard, declared check, `enforcePermissionCheck`, audit — applied AFTER a
procedure's own `.input()` parser, because the last four read the validated
input and tRPC appends its input middleware where `.input()` is called.
Composed the other way round the authorization check reads no scope id, the
lineage guard compares nothing, and the audit row lands with no arguments, no
project and no organization. Nothing reports an error.

The audit redaction rules moved intact, keying included. In particular
`REDACTED_SCALAR_FIELDS_BY_ACTION` is keyed by tRPC action path, because
`secrets.create` and `secrets.update` carry the plaintext secret in a
top-level `value` field the object-walking redactor does not reach, and
`value` is an ordinary word other mutations use for harmless things.
