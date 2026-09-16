#!/usr/bin/env python3
"""Print the served surface — REST routes and tRPC procedures — so two versions
of the tree can be diffed.

A package test passing while a route moved is the most dangerous handoff there
is, and a rename wave is exactly when it happens. Renaming a service method is
safe; renaming the operation id or procedure name beside it is a wire change
wearing the same clothes.

  served-surface.py <paths...>                 # the working tree
  served-surface.py --ref HEAD <paths...>      # any ref
  served-surface.py --diff HEAD <paths...>     # ref vs working tree, exit 1 on drift
"""
import argparse, re, subprocess, sys

REST = re.compile(r"\.(get|post|put|patch|delete|options|head)\(\s*\"([^\"]*)\"\s*,\s*\"([^\"]+)\"")
CONTRACT = re.compile(r"defineTrpcContract\(\s*\"([^\"]+)\"")
PROC = re.compile(r"\.(query|mutation|subscription)\(\s*\"([^\"]+)\"")


def git(*a):
    r = subprocess.run(["git", *a], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def files(paths, ref):
    if ref:
        out = git("ls-tree", "-r", "--name-only", ref, "--", *paths) or ""
    else:
        out = git("ls-files", "--", *paths) or ""
    return [f for f in out.split("\n") if f.endswith((".rest.ts", ".trpc.ts"))]


def surface(paths, ref):
    found = set()
    for path in files(paths, ref):
        text = git("show", f"{ref}:{path}") if ref else None
        if text is None:
            try:
                text = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
        namespace = None
        for line in text.split("\n"):
            m = CONTRACT.search(line)
            if m:
                namespace = m.group(1)
            for verb, route, op in REST.findall(line):
                found.add(f"REST {verb.upper():7} {route:45} -> {op}")
            if namespace:
                for kind, name in PROC.findall(line):
                    found.add(f"TRPC {namespace}.{name}  ({kind})")
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref")
    ap.add_argument("--diff")
    ap.add_argument("paths", nargs="+")
    a = ap.parse_args()

    if a.diff:
        before, after = surface(a.paths, a.diff), surface(a.paths, None)
        gone, added = sorted(before - after), sorted(after - before)
        if not gone and not added:
            print(f"served surface unchanged vs {a.diff}  ({len(before)} entries)")
            return
        print(f"SERVED SURFACE MOVED vs {a.diff}:  -{len(gone)} +{len(added)}")
        for g in gone:
            print("  REMOVED  " + g)
        for x in added:
            print("  ADDED    " + x)
        sys.exit(1)

    for entry in sorted(surface(a.paths, a.ref)):
        print(entry)


if __name__ == "__main__":
    main()
