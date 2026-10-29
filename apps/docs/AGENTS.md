# Docs app boundaries

This is a self-owned static app. Its feature folders do not participate in the
server module installation pipeline. React and the shared design system remain
the presentation owners; the complete reading surface renders at build time.

Browser schemas, including portable schemas also used during prerendering, may
import Zod 4 from `zod/mini`. This is a docs-specific exception to the repository's
Zod import convention. Filesystem and compiler input validation uses `zod`.
Keep one schema authority and preserve defaults, strictness and error behavior.

Keep the initial browser JavaScript within the existing 3,000-byte gzip guard.
Build caching must account for transitive inputs and validate cached records.
Parallel renderers must produce deterministic pages, styles and discovery files.

Documentation screenshot captures must include a light and a dark variant at the
same viewport and state. Authored theme pairs must show only the image matching
the current theme, including inside frames. Verify both variants when changing
media presentation.
