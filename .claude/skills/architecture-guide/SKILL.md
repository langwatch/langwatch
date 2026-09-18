---
name: architecture-guide
description: Pointer to the one architecture record. Read dev/docs/ARCHITECTURE.md before composing a process, writing a module, or citing any shape.
---

# LangWatch architecture guide

**The architecture has exactly one record: `dev/docs/ARCHITECTURE.md`.**

Read it. Everything this skill's references used to teach lives there or was
ruled dead on 2026-09-17/18. The ruling decision records it cites are ADR-147
(compiler-checked process supply) and ADR-148 (declared browser supply); the
enforcement is the linter (`packages/oxlint-rules`,
`packages/architecture-enforcer`), which outranks all prose.

Do not restore deleted references to this directory. When the record is wrong,
fix `dev/docs/ARCHITECTURE.md` in the same commit as the code.
