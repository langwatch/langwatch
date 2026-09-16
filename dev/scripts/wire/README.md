# Served-surface diff

`served-surface.py` prints every REST route and tRPC procedure declared under
the paths you give it, so two versions of the tree can be compared.

```bash
python3 dev/scripts/wire/served-surface.py --diff HEAD modules/project modules/user
python3 dev/scripts/wire/served-surface.py --ref origin/main modules/project
python3 dev/scripts/wire/served-surface.py modules/project           # working tree
```

Exit 1 when the surface moved, listing what went and what arrived.

## Why this exists

A green package suite while a route moved is the most dangerous handoff there
is, and `COORDINATOR.md` section 8 makes confirming it the coordinator's job
rather than a lane's: package tests are the lane's evidence, cross-module
integration is the coordinator's.

A **renaming** wave is when this earns its keep. Renaming a service method is
safe. Renaming the operation id or procedure name declared beside it is a wire
change wearing the same clothes — and the fallible-naming family asks lanes to
rename `get*` to `find*`, which is exactly the shape that hits an operation id
by accident.

It reads two declaration forms:

- `.get("/:projectId", "getProject")` and the other verbs, in `*.rest.ts`
- `defineTrpcContract("suites")` followed by `.query("getAll")` /
  `.mutation("create")` / `.subscription(...)`, in `*.trpc.ts`

HEAD is the right baseline while lanes are running, because lanes never commit.

A status collapsed to 200 or a setting that stopped being configurable is a
regression, not a delta — this tool sees names, not those. It narrows the
question; it does not answer all of it.
