# Comment-sweep collection checks

The two checks a coordinator runs before collecting a `comment-block-size` slice.
They live here because they were written from scratch in a job scratch directory
twice, and lost twice.

## `verify-slice.py` — the sound one

Asserts a slice changed comment lines only. It computes the set of line numbers
inside a comment in each version and requires every removed line to have been
inside one, and every added line to be inside one.

```bash
python3 dev/scripts/comment-sweep/verify-slice.py --files <slice.tsv>     # tree vs HEAD
python3 dev/scripts/comment-sweep/verify-slice.py --files <list> --base REF
python3 dev/scripts/comment-sweep/verify-slice.py --commit SHA            # one commit vs its parent
```

Use `--commit` when checking work already landed. Without it, pointing the tool
at an old ref compares the **working tree** against that ref and reports every
commit landed since, including other sessions' — which reads as a false alarm.

It replaced two checks that were each unsound. A changed-line pattern grep is
blind to JSX continuation lines, which carry no `*` and so read as code. A
character-scanning strip-and-compare treated `/*` inside a regex literal as
opening a comment and a backtick inside a comment as opening a template literal;
once desynced it ran to the next `*/`, so its verdict depended on comment length.

This one is conservative by construction: a line counts as a comment only on
evidence at the start of the line, so anything unrecognised reads as code and
fails loudly. It can raise a false alarm; it cannot silently accept a code change.
Non-source files are skipped, because JS comment syntax applied to markdown reads
every prose line as code.

## `count-orphans.py` — the one that catches a lane gaming the rule

A closed `/** … */`, a blank line, then another `/**`. Only the block immediately
preceding a declaration attaches to it, so the first documents nothing.

```bash
python3 dev/scripts/comment-sweep/count-orphans.py --ref HEAD <slice.tsv>   # baseline first
python3 dev/scripts/comment-sweep/count-orphans.py <slice.tsv>              # after the lane
```

Take the baseline **before** the lane runs. A rise means findings were cleared by
dividing blocks rather than shortening them: each half passes the rule, the prose
survives, the count falls, and the comment is silently detached from what it
documents. One lane cleared 19 findings that way; the slice was fully lint-clean
and provably comment-only and still wrong. No other check can see it.

## `count-splits.py` — the general form of that check

`count-orphans.py` only ever matched a **single-line** `/** … */` before the
blank line. A lane found the gap: it split a *multi-line* JSDoc from a `//`
section divider beneath it, which clears the finding the same way and the regex
cannot see it.

```bash
python3 dev/scripts/comment-sweep/count-splits.py --files <slice.tsv>
python3 dev/scripts/comment-sweep/count-splits.py --commit SHA
```

It reports every blank line the diff *inserted between two comment lines*, which
is the gaming pattern in general: `comment-block-size` counts adjacent comment
lines as one block, so a blank line halves the count while changing no prose.
Exit 1 if any are found. Run it instead of relying on the orphan regex alone;
keep both, since they fail on different inputs.

A real one this caught, in a case where the block turned out to be residue from
a move: the JSDoc for `fillServerOnlyTraceSources` had been left behind in
`evaluation-execution.service.ts` when the method moved to
`evaluation-data.service.ts`, and in the stale build output it had re-attached
to `runEvaluation` — documenting a different method entirely. The fix was
deleting it, not dividing it.

Both accept a slice file in either `<count>\t<path>` or bare-path form.
