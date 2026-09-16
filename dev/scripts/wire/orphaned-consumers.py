#!/usr/bin/env python3
"""After a rename slice: find callers left behind outside the slice.

A lane owns some paths. When it renames a method on an interface that lives in a
`contract` package, consumers anywhere in the repository break - and none of the
usual collection checks look there. Scope checks the slice, the wire check reads
routes, the package tests run the package. A consumer three modules away is
invisible to all three.

This takes the symbols a diff renamed AWAY and greps the whole tree for
survivors outside the changed set.

  orphaned-consumers.py --base HEAD <paths...>     # uncommitted slice
  orphaned-consumers.py --commit SHA               # a landed commit
"""
import argparse, re, subprocess, sys

IDENT = re.compile(r"\b((?:try|get|list)[A-Z][A-Za-z0-9_]*)\b")
SKIP = ("/node_modules/", "/dist/", "/.git/")
SRC = (".ts", ".tsx", ".mts", ".cts")


def git(*a):
    r = subprocess.run(["git", *a], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="HEAD")
    ap.add_argument("--commit")
    ap.add_argument("paths", nargs="*")
    a = ap.parse_args()

    if a.commit:
        diff = git("diff", "--unified=0", f"{a.commit}^", a.commit, "--", *a.paths)
        changed = set(git("diff", "--name-only", f"{a.commit}^", a.commit, "--", *a.paths).split("\n"))
    else:
        diff = git("diff", "--unified=0", a.base, "--", *a.paths)
        changed = set(git("diff", "--name-only", a.base, "--", *a.paths).split("\n"))
    changed.discard("")

    removed, added = set(), set()
    for line in diff.split("\n"):
        if line.startswith("-") and not line.startswith("---"):
            removed |= set(IDENT.findall(line))
        elif line.startswith("+") and not line.startswith("+++"):
            added |= set(IDENT.findall(line))

    # a name that vanished from the slice entirely is the one to chase
    gone = sorted(removed - added)
    if not gone:
        print("no renamed-away symbols in this slice")
        return

    print(f"symbols renamed away: {len(gone)}")
    orphans = {}
    for sym in gone:
        hits = []
        for line in git("grep", "-n", "--", f"\\b{sym}\\b").split("\n"):
            if not line or any(s in line for s in SKIP):
                continue
            path = line.split(":", 1)[0]
            # docs and plans mention these names constantly; only code can break
            if path in changed or not path.endswith(SRC):
                continue
            hits.append(line[:150])
        if hits:
            orphans[sym] = hits

    if not orphans:
        print("no surviving references outside the slice: OK")
        return

    print(f"\nSURVIVING CODE REFERENCES OUTSIDE THE SLICE for {len(orphans)} symbol(s):")
    print("Triage each: it is either a consumer left behind, or an unrelated")
    print("interface that legitimately declares the same method name. The give-away")
    print("is whether the file imports the renamed symbol's own package.")
    for sym, hits in sorted(orphans.items()):
        print(f"\n  {sym}  ({len(hits)})")
        for h in hits[:6]:
            print("    " + h)
    sys.exit(1)


if __name__ == "__main__":
    main()
