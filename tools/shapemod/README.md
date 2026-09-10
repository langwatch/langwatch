# shapemod

Moves `modules/<m>/server/src/{ports,adapters}` files onto the strict
repository shape and finds dead legacy-transport files. Classification is
regexp over import lines and member names (no TS parser); `tslsp-cli` does
the semantic move, rename and diagnostics check.

```
shapemod ports [--apply] [--root .] <module-dir>          # plan, or apply, one module
shapemod dead-transports [--apply] [--root .] <module-dir>...
shapemod inventory [--root .]                              # repo-wide counters + per-module table
```

Dry-run by default (prints the plan table); `--apply` writes. A non-zero
`diagnostics` result after a move aborts the run. See the package's doc
comment (`cli.go`, `classify.go`) for the classification rules.
