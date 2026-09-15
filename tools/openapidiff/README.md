# openapidiff

`openapidiff` compares two OpenAPI 3 JSON documents by operation semantics and
the reachable component closure. Object key order and JSON formatting do not
affect equality. Human output is deterministic; `-json` emits a deterministic
array of changes with explicit before/after values.

```text
openapidiff [ -json ] [ -strict ] [ -path-prefix PREFIX ] [ -method METHOD ] BASE CANDIDATE
```

Exit status is `0` for equality, `1` for semantic differences, and `2` for
invalid arguments/documents or output errors. Structural validation is always
performed, including operation/path shape, local component references, and
OpenAPI 3.1 boolean schemas. Generated artifacts may contain empty Responses
Objects; these are accepted by default for comparison. `-strict` additionally
rejects empty Responses Objects and exits `2` with a validation error.
