#!/usr/bin/env python3
"""Count orphaned JSDoc blocks: a closed /** ... */ block, a blank line, then
another /** . Only the block immediately preceding a declaration attaches to it,
so the first one documents nothing. A rise in this count means a lane cleared
findings by dividing blocks rather than shortening them."""
import re, subprocess, sys

PAT = re.compile(r"^[ \t]*/\*\*[^\n]*\*/[ \t]*\n[ \t]*\n[ \t]*/\*\*", re.M)


def read(path, ref):
    if ref:
        r = subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True, text=True)
        return r.stdout if r.returncode == 0 else ""
    try:
        return open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return ""


def main():
    ref = None
    args = sys.argv[1:]
    if args and args[0] == "--ref":
        ref = args[1]
        args = args[2:]
    paths = []
    for line in open(args[0]):
        line = line.rstrip("\n")
        if not line.strip():
            continue
        # slice files are "<finding-count>\t<path>"; a bare path list is also accepted
        paths.append(line.split("\t")[-1].strip())
    total, per = 0, {}
    for p in paths:
        n = len(PAT.findall(read(p, ref)))
        if n:
            per[p] = n
        total += n
    print(f"orphan blocks: {total}   (in {len(per)} of {len(paths)} files)   ref={ref or 'working tree'}")
    for p, n in sorted(per.items(), key=lambda x: -x[1])[:25]:
        print(f"  {n:3d}  {p}")


if __name__ == "__main__":
    main()
