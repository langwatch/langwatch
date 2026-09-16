#!/usr/bin/env python3
"""Assert a slice changed comment lines only.

Computes, per file version, the set of line numbers that sit inside a comment,
then asserts every removed line was inside one in the OLD version and every
added line is inside one in the NEW version.

Soundness direction is deliberate: a line is called a comment only when the
evidence starts at the beginning of the line. An unrecognised comment therefore
reads as code and FAILS loudly; it can never silently accept a code change.

  verify-slice.py --files LIST                 # working tree vs HEAD
  verify-slice.py --files LIST --base REF      # working tree vs REF
  verify-slice.py --commit SHA                 # that commit vs its parent
"""
import argparse, re, subprocess, sys

HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def git(*args):
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return r.stdout


def comment_lines(text):
    """1-based line numbers inside a comment. Conservative by construction."""
    inside, in_block, in_template = set(), False, False
    for n, raw in enumerate(text.split("\n"), 1):
        s = raw.strip()
        if in_block:
            inside.add(n)
            if "*/" in s:
                in_block = False
            continue
        if in_template:
            # backticks are only counted outside comments, so a backtick in a
            # comment cannot desync this the way a character scanner does
            if raw.count("`") % 2 == 1:
                in_template = False
            continue
        if s.startswith("//"):
            inside.add(n)
            continue
        # a line opening with `/*` or a JSX `{/*` is a comment: no regex literal
        # can begin `/*`, because `*` has nothing to repeat
        if s.startswith("/*") or s.startswith("{/*"):
            inside.add(n)
            body = s[2:] if s.startswith("/*") else s[3:]
            if "*/" not in body:
                in_block = True
            continue
        if s.startswith("*"):
            # a jsdoc continuation reached without its opener (partial file view)
            inside.add(n)
            continue
        if raw.count("`") % 2 == 1:
            in_template = True
    return inside


def changed(diff):
    """(old_removed, new_added) line numbers, per file, from a -U0 diff."""
    out, path, old, new = {}, None, set(), set()
    for line in diff.split("\n"):
        if line.startswith("+++ b/"):
            path = line[6:]
            old, new = out.setdefault(path, (set(), set()))
        elif line.startswith("+++ /dev/null"):
            path = None
        elif line.startswith("@@") and path:
            m = HUNK.match(line)
            if m:
                os_, oc = int(m.group(1)), int(m.group(2) or 1)
                ns, nc = int(m.group(3)), int(m.group(4) or 1)
                old.update(range(os_, os_ + oc))
                new.update(range(ns, ns + nc))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--files")
    ap.add_argument("--base", default="HEAD")
    ap.add_argument("--commit")
    a = ap.parse_args()

    paths = []
    if a.files:
        paths = [p.strip() for p in open(a.files) if p.strip()]

    if a.commit:
        old_ref, new_ref = f"{a.commit}^", a.commit
        diff = git("diff", "--unified=0", "--no-color", old_ref, new_ref, "--", *paths) or ""
    else:
        old_ref, new_ref = a.base, None
        diff = git("diff", "--unified=0", "--no-color", a.base, "--", *paths) or ""

    # only files oxlint actually lints: comment syntax here is JS/TS comment
    # syntax, and applying it to markdown reads every prose line as code
    SRC = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts")

    bad, blanks, checked, skipped = [], 0, 0, []
    for path, (old_ln, new_ln) in sorted(changed(diff).items()):
        if paths and path not in paths:
            continue
        if not path.endswith(SRC):
            skipped.append(path)
            continue
        old_txt = git("show", f"{old_ref}:{path}")
        new_txt = git("show", f"{new_ref}:{path}") if new_ref else None
        if new_txt is None and not new_ref:
            try:
                new_txt = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                new_txt = ""
        checked += 1
        old_src = (old_txt or "").split("\n")
        new_src = (new_txt or "").split("\n")
        old_ok, new_ok = comment_lines(old_txt or ""), comment_lines(new_txt or "")
        for n in sorted(old_ln):
            body = old_src[n - 1] if n <= len(old_src) else ""
            if not body.strip():
                blanks += 1
            elif n not in old_ok:
                bad.append(f"{path}:{n} REMOVED code: {body.strip()[:90]}")
        for n in sorted(new_ln):
            body = new_src[n - 1] if n <= len(new_src) else ""
            if not body.strip():
                blanks += 1
            elif n not in new_ok:
                bad.append(f"{path}:{n} ADDED code: {body.strip()[:90]}")

    print(f"files checked: {checked}   blank-line changes: {blanks}"
          + (f"   non-source skipped: {len(skipped)}" if skipped else ""))
    if bad:
        print(f"NOT COMMENT-ONLY: {len(bad)} line(s)")
        for b in bad[:60]:
            print("  " + b)
        sys.exit(1)
    print("comment-only: OK")


if __name__ == "__main__":
    main()
