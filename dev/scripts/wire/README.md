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


# Orphaned-consumer check

`orphaned-consumers.py` takes the symbols a slice renamed **away** and searches
the whole tree for code that still calls them outside the changed files.

```bash
python3 dev/scripts/wire/orphaned-consumers.py --base HEAD modules/user modules/project
python3 dev/scripts/wire/orphaned-consumers.py --commit <sha>
```

## Why this exists

It was written after a collected slice broke six modules. A lane renamed
`UserApi.tryFindById` to `findById`. `UserApi` lives in a **contract** package,
so its consumers are everywhere, and the lane owned four modules. Every other
consumer was left calling a method the interface no longer declares - `role`,
`auth`, `presence`, `data-retention`, `ops`, `sso`, and a
`Pick<UserApi, "tryFindById" | "updateProfile">` in SCIM that selected the dead
key by name. 34 sites across 20 files.

**None of the other collection checks could see it.** Scope checks the slice.
The served-surface diff reads routes, and no route moved. The package suites run
the package, and the package was fine. A consumer three modules away is outside
all three.

Worse, **half of it was invisible to the type checker too.** Five SCIM test
doubles built with `vi.fn()` object literals kept the old key without a type
error, and only failed at runtime with `this.userService.findById is not a
function`. So a rename is verified by RUNNING the tests of every affected
package, never only by compiling them.

## Reading the output

Noisy by design, because method names repeat across unrelated interfaces:
`tryFindById` is declared independently by the langy session-key, SSO
connection, model-provider, scenario, gateway and stored-object repositories.
Triage each hit - the give-away is whether the file imports the renamed symbol's
own package. A hit inside an unrelated interface is fine; a hit in something
that imports the contract is a consumer left behind.

Run it on any slice that renames a symbol declared in a `contract` package, and
treat a non-empty result as a question rather than a verdict.
