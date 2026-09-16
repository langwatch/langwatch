#!/usr/bin/env python3
"""Finds methods a rename left called but nowhere defined.

Two regressions on the lint drive had the same shape: a slice renamed a method,
updated every caller inside the module it owned, and left callers in `apps/*`
or another module untouched. Neither was caught by the slice's own checks,
because a slice checks the paths it owns and the callers were not in them.

Neither was caught by the type checker either. The first survived because the
doubles were `vi.fn()` object literals, which keep an old key happily; the
second survived because the declaration build was failing, so `tsc` was not
running at all. So this looks at neither types nor ownership: it asks the one
question that survives both failures. Is this name called, and defined nowhere?

    python3 dev/scripts/wire/orphaned-methods.py origin/main..HEAD
    python3 dev/scripts/wire/orphaned-methods.py --names findById,getDetail

Exit 1 when an orphan is found, so it can gate a collection.
"""

import argparse
import re
import subprocess
import sys

SOURCE_GLOBS = ["*.ts", "*.tsx"]

# A method name as a rename would produce: camelCase, long enough not to collide
# with a local variable. `id` or `run` would match half the tree and prove nothing.
NAME_SHAPE = re.compile(r"\b((?:try|find|get|list|read|load|fetch|resolve)[A-Z][A-Za-z0-9]{3,})\b")
MIN_NAME_LENGTH = 8

# Above this the input is not a rename wave and the alternation regex degrades.
NAME_BUDGET = 300


def removed_identifiers(rev_range):
    """Every method-shaped identifier the range deleted from a line."""
    diff = subprocess.run(
        ["git", "diff", "--unified=0", rev_range],
        capture_output=True, text=True, check=True,
    ).stdout

    names = set()
    for line in diff.splitlines():
        if not line.startswith("-") or line.startswith("---"):
            continue
        names.update(NAME_SHAPE.findall(line))

    return {n for n in names if len(n) >= MIN_NAME_LENGTH}


def source_files():
    """Every TypeScript source git can see, committed or not, minus build output.

    `--others --exclude-standard` is what makes this usable mid-drive. A lane's
    work sits uncommitted for hours, and a brand-new file - the test double that
    still defines the old name, the caller written against it - is exactly where
    an orphan hides. Listing only tracked files reports a confident clean run
    over a tree whose newest half it never opened.
    """
    out = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", *SOURCE_GLOBS],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    seen = dict.fromkeys(out)  # --cached and --others can both name a path
    return [f for f in seen if "/dist/" not in f and "/node_modules/" not in f]


def index_tree(names):
    """One pass over the tree, classifying every occurrence of every name.

    The first version of this ran three greps per name over the whole
    repository. At a few hundred renamed names that is hours, and a check that
    takes hours is a check nobody runs, which is the same as not having one.
    """
    if not names:
        return {}

    alternation = "|".join(sorted(map(re.escape, names), key=len, reverse=True))
    call_re = re.compile(rf"\.({alternation})\s*\(")
    decl_re = re.compile(rf"(?:^|[^.A-Za-z0-9_])(?:async\s+)?({alternation})\s*[(<:]")
    string_re = re.compile(rf"[\"']({alternation})[\"']")
    # One compiled scan decides whether a file is worth reading line by line.
    # The obvious guard - `any(n in text for n in names)` - is a substring
    # search per name per file, which at branch scale is millions of them and
    # turns a one-second check back into one that never finishes.
    any_name = re.compile(alternation)

    found = {n: {"calls": [], "declarations": [], "strings": []} for n in names}

    for path in source_files():
        try:
            text = open(path, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        if not any_name.search(text):
            continue

        for lineno, line in enumerate(text.splitlines(), 1):
            calls_here = {m.group(1) for m in call_re.finditer(line)}
            for name in calls_here:
                found[name]["calls"].append(f"{path}:{lineno}")
            for match in decl_re.finditer(line):
                name = match.group(1)
                # `a.findThing(` matches the declaration shape too; a call wins.
                if name not in calls_here:
                    found[name]["declarations"].append(f"{path}:{lineno}")
            for match in string_re.finditer(line):
                found[match.group(1)]["strings"].append(f"{path}:{lineno}")

    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rev_range", nargs="?", help="a git range, e.g. origin/main..HEAD")
    parser.add_argument("--names", help="comma-separated names to check instead of a range")
    args = parser.parse_args()

    if args.names:
        names = {n.strip() for n in args.names.split(",") if n.strip()}
    elif args.rev_range:
        names = removed_identifiers(args.rev_range)
    else:
        parser.error("give a rev range or --names")

    # A wave renames tens of symbols. A long-lived branch's whole diff yields
    # thousands, and an alternation that size is pathological - the run stops
    # looking finished and starts looking hung. Say so rather than hang.
    if len(names) > NAME_BUDGET:
        print(
            f"{len(names)} candidate names from that range - too many to be a "
            f"rename wave.\nThis check reads one wave's renames, not a whole "
            f"branch. Narrow the range (a commit or two), or pass --names.",
            file=sys.stderr,
        )
        return 2

    print(f"checking {len(names)} renamed-away name(s)\n")

    index = index_tree(names)
    orphans = []
    for name in sorted(names):
        entry = index.get(name)
        if not entry:
            continue
        if (entry["calls"] or entry["strings"]) and not entry["declarations"]:
            orphans.append((name, entry["calls"], entry["strings"]))

    if not orphans:
        print("no orphans: every name still called is still defined")
        return 0

    for name, calls, strings in orphans:
        print(f"ORPHAN  {name}  called {len(calls)}x, named in {len(strings)} "
              f"string(s)/type(s), declared nowhere")
        for location in (calls + strings)[:6]:
            print(f"          {location}")
    print(f"\n{len(orphans)} orphan(s). A caller outside the renaming module was missed.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
