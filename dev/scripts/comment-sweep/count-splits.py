#!/usr/bin/env python3
"""Find findings cleared by SPLITTING a comment block rather than shortening it.

`comment-block-size` counts adjacent comment lines as one block, so inserting a
blank line between two of them halves the count while changing no prose. Each
half then passes, the finding disappears, and the comment is silently detached
from whatever it documented.

This generalises the orphan-block regex, which only ever matched a single-line
`/** ... */` before the blank and so missed a multi-line JSDoc split from a
following `//` divider.

  count-splits.py --files <slice.tsv> [--base REF]
  count-splits.py --commit SHA [--files <slice.tsv>]
"""
import argparse, re, subprocess, sys

HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
SRC = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts")


def git(*a):
    r = subprocess.run(["git", *a], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def is_comment(line):
    s = line.strip()
    return s.startswith(("//", "/*", "*", "{/*")) and s != ""


def added_blanks(diff):
    out, path, ln = {}, None, 0
    for line in diff.split("\n"):
        if line.startswith("+++ b/"):
            path = line[6:]
            out.setdefault(path, [])
        elif line.startswith("@@") and path:
            m = HUNK.match(line)
            if m:
                ln = int(m.group(1))
        elif path and line.startswith("+") and not line.startswith("+++"):
            if not line[1:].strip():
                out[path].append(ln)
            ln += 1
        elif path and line.startswith(" "):
            ln += 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--files")
    ap.add_argument("--base", default="HEAD")
    ap.add_argument("--commit")
    a = ap.parse_args()

    paths = []
    if a.files:
        for line in open(a.files):
            line = line.rstrip("\n")
            if line.strip():
                paths.append(line.split("\t")[-1].strip())

    if a.commit:
        diff = git("diff", "--unified=0", "--no-color", f"{a.commit}^", a.commit, "--", *paths) or ""
        new_ref = a.commit
    else:
        diff = git("diff", "--unified=0", "--no-color", a.base, "--", *paths) or ""
        new_ref = None

    splits = []
    for path, blanks in added_blanks(diff).items():
        if not path.endswith(SRC) or not blanks:
            continue
        txt = git("show", f"{new_ref}:{path}") if new_ref else None
        if txt is None:
            try:
                txt = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
        src = txt.split("\n")
        for n in blanks:
            before = next((src[i] for i in range(n - 2, -1, -1) if src[i].strip()), "")
            after = next((src[i] for i in range(n, len(src)) if src[i].strip()), "")
            if is_comment(before) and is_comment(after):
                splits.append(f"{path}:{n}  {before.strip()[:50]}  ||  {after.strip()[:50]}")

    print(f"blank lines inserted between two comment lines: {len(splits)}")
    for s in splits[:40]:
        print("  " + s)
    sys.exit(1 if splits else 0)


if __name__ == "__main__":
    main()
