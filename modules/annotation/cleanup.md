# Annotation cleanup

Scope: finish annotation as the reference implementation. Keep feature naming.
Shared changes support this slice; they do not certify the entire rewrite.

## Settled shape

- One callable `AnnotationApi`, implemented by `AnnotationApp`.
- The app owns peer calls, user enrichment, reference validation and review effects.
- Three private entity services: annotation, score and queue.
- Four repository interfaces, each with separate Postgres and memory implementations.
  The queue service uses queue and queue-item repositories.
- Startup selects a repository bundle once. The app knows only repository interfaces.
- Prisma model tuples provide native delegate types and runtime claims; the bundle
  derives its Prisma requirement. Narrowed types do not isolate database access at runtime.
- Public contracts describe app and transport calls. Internal repository inputs
  remain in the server package.
- REST and tRPC use flat transport files and the shared API framework.
- Annotation IDs use KSUID with `ANNOTATION_KSUID_RESOURCE`.
- Original peer errors propagate. Trace markers remain best effort after committed
  annotation writes; guaranteed delivery would need durable retry/idempotency work.
- The obsolete annotation backfill and migration are removed.
- The larger shared UI-session redesign remains deferred.

## Completed and checked

- [x] Replace service exposure and callback bags with the callable app boundary.
- [x] Remove obsolete ports, adapters, backfill registration and unused fixtures.
- [x] Remove duplicate public queue type mirrors and stale project-error wrappers.
- [x] Use specific queue-id, queue-slug, user-page and queue-page repository calls.
- [x] Preserve native Prisma result inference and validate uncertain JSON fields.
- [x] Use shared Prisma error classification and concrete handled lookup errors.
- [x] Build the default memory app without separately seeded peer metadata.
- [x] Validate references and enrich current member/score summaries in the app.
- [x] Correct empty My Queue IDs, empty member lists and missing-update parity.
- [x] Preserve wrong-trace rejection before suggestion or annotation mutations.
- [x] Keep committed annotation creation/deletion successful on marker failure.
- [x] Enforce exact declared browser dependencies and repository construction shapes.
- [x] Confirm tRPC supplies an authenticated actor with an ID.
- [x] Recover deleted boundary coverage in canonical app tests.
- [x] Review annotation and the shared Prisma helper independently; fix the findings.

## Verification evidence

The following checks passed during this cleanup:

| Check                                              | Result                                               |
| -------------------------------------------------- | ---------------------------------------------------- |
| Annotation contract                                | 51 tests; typecheck                                  |
| Annotation server                                  | 44 unit tests; typecheck                             |
| Annotation integration                             | 10 tests, including real Postgres reach and paging   |
| Annotation web                                     | 169 tests; architecture Oxc after structural cleanup |
| UI queue walker                                    | 49 tests; architecture Oxc after structural cleanup  |
| API framework                                      | 515 tests                                            |
| API annotation composition and REST family         | 7 tests                                              |
| Worker production composition and infrastructure   | 59 tests                                             |
| Prisma repository helper                           | 8 focused tests; source typecheck                    |
| Repository/interface and declaration lint fixtures | Focused suites passed                                |
| Test-quality review                                | Completed without findings                           |
| Comment review                                     | Completed; remaining annotation cleanup listed below |

These counts describe the checked suites, not complete product readiness.
A UI source check resolving annotation-web directly from source has no
annotation diagnostics; the full UI project still has unrelated errors.

## Remaining gates

- [x] Finish browser complexity, comment and temporal-value cleanup, preserving
      UI layer direction. Re-run annotation browser and moved host tests.
- [x] Run the final architecture Oxc scan across annotation and its UI process wiring.
      Resolve annotation findings without new baselines.
- [x] Re-run the architecture policy scan and `git diff --check` after final edits.
- [x] Refresh the exact-path commit manifest after review; retain unrelated staged
      and working-tree changes.
- [ ] Boot the complete product and perform annotation API/visual comparisons.

`dev/scripts/commit-annotation-cleanup.sh` validates the recorded annotation
snapshot by default. Its `--commit "message"` mode commits that exact feature
slice and its annotation-specific process wiring. Shared framework changes remain
outside this snapshot for their owning commit batches. The helper was tested in
a throwaway repository; it preserves unrelated staged and unstaged changes.

## External blockers

The last real API boot stopped in the separate stored-object composition:
`maximumUploadBytes must be a non-negative safe integer`. Its new app requires
production infrastructure/configuration that its current composition does not
supply. Annotation does not bypass that boot failure or fabricate those dependencies.

Annotation-web's declaration build is blocked by experiment/project
`Instant` → `TimeInput` diagnostics. The Prisma package-wide declaration build
also reports unrelated replay-marker readonly-tuple and missing-IORedis diagnostics.
Source and annotation-server checks passing do not make those checks green.

Until those prerequisites are repaired and the running annotation journey is
verified, this checklist remains open.
