# LangWatch skills workspace

This directory is the **single source of truth** for LangWatch's agent
skills — the AgentSkills-style instruction sets that teach a coding agent
(Claude Code, Cursor, opencode, …) how to use LangWatch. One canonical
`SKILL.mdx` per skill feeds THREE consumers, and everything else in here is the
tooling that keeps those consumers in lockstep.

If you change a `SKILL.mdx` and walk away, one of the consumers ships stale
content. Read "The pipeline" below before editing anything.

## What lives where

| Path | What it is |
|---|---|
| `<skill>/SKILL.mdx` (e.g. `tracing/`, `github/`) | Canonical source for a **feature skill**. Public skills are curated in `FEATURE_SKILLS`; Langy-only skills are curated in `NATIVE_ONLY_SKILLS`. |
| `recipes/<name>/SKILL.mdx` | **Recipe** skills (use-case cookbooks). Auto-discovered: every `recipes/*/SKILL.mdx` is published, no registration needed. |
| `_shared/*.mdx` | Partials (`<CliSetup />`, `<PlanLimits />`, …) imported by skills and inlined at compile time. Published output never references `_shared/`. |
| `_lib/` | Shared tooling: `feature-skills.ts` (the ONE definition of "our published skill set"), `mdx-inline.ts` (partial inliner), `frontmatter.ts`. |
| `_compiler/` | Generators: `compile.ts` (copy-paste prompts) and `native.ts` (opencode `SKILL.md` files for Langy). |
| `_compiled/*.txt` | **Gitignored** copy-paste prompts consumed by the docs pipeline. |
| `_compiled/native/` | **Committed** opencode skills consumed by the Langy agent image. |
| `_publish/sync.ts` | Publisher: wipes and re-fills a checkout of the public [langwatch/skills](https://github.com/langwatch/skills) repo. |
| `_tests/` | Dogfood scenario tests (drive a real sub-agent against each skill; local-only, cost money) plus fast structural tests (`native-skills.test.ts`, `publish-sync.test.ts`) that run with plain `vitest`. |
| `initial-prompt.md` | Historical: the original kickoff brief this workspace was built from. Context only — nothing consumes it. |
| `version.txt`, `CHANGELOG.md` | Version stamp copied into the public repo on publish, and its log. |

## The pipeline: one source, three consumers

```
skills/<name>/SKILL.mdx  +  skills/_shared/*.mdx
        │  (inlineMdx: partials inlined, frontmatter preserved)
        │  public selection = listPublishedSkills(): FEATURE_SKILLS + recipes
        │  Langy selection = listNativeSkills(): public + native-only skills
        │
        ├─ 1. PUBLIC SKILLS REPO
        │     _publish/sync.ts → checkout of langwatch/skills
        │     (recipes nest under recipes/<slug>)
        │     Runs automatically: .github/workflows/skills-publish.yml on every
        │     push to main that touches skills sources.
        │
        ├─ 2. DOCS COPY-PASTE PROMPTS
        │     _compiler/compile.ts → _compiled/<skill>.{platform,docs}.txt (gitignored)
        │     → docs/scripts/sync-prompts.sh → accordion markup generated into
        │     docs/skills/directory.mdx + pms-and-domain-experts.mdx (committed)
        │     docs-ci fails if those pages are stale.
        │
        └─ 3. LANGY, THE IN-PRODUCT AGENT
              _compiler/native.ts → _compiled/native/<slug>/SKILL.md (committed;
              recipes flattened — opencode discovers skills one level deep)
              → Dockerfile.langyagent COPYs _compiled/native/ into
                services/langyagent/internal/assets/skills/ BEFORE `go build`
              → //go:embed bakes the tree into the manager binary
              → the worker pool materializes it to disk at startup and each
                worker's $HOME/.config/opencode/skills symlinks to it
              → opencode discovers each <slug>/SKILL.md as an invokable skill.
```

Langy's native selection is a strict superset of the public selection, so what
we publish always ships in Langy. The `github/` skill is Langy-only because it
depends on provisioned `GH_TOKEN` and bot-authored PR behavior; its canonical
source still lives here, while `listPublishedSkills()` keeps it out of the
public repository. The copy under the Go embed directory supports local builds,
and `_tests/native-skills.test.ts` pins it to the root-compiled output.

## Adding or changing a skill

1. **Feature skill**: create `<name>/SKILL.mdx` and add `<name>` to
   `FEATURE_SKILLS` in `_lib/feature-skills.ts`. **Recipe**: create
   `recipes/<name>/SKILL.mdx` — that's it, discovery is automatic.
   Skill naming follows feature-map leaf IDs (ADR-012).
2. Frontmatter must carry `name` and `description` — the description is what a
   model uses to decide the skill applies, so write it as "what you get + when
   to use", not marketing copy. `user-prompt` is the canonical trigger phrase.
3. Regenerate the committed outputs:
   ```bash
   bash skills/_compiled/generate.sh
   ```
   and commit the `_compiled/native/` changes together with the source change.
   `_tests/native-skills.test.ts` fails if the committed native output drifts
   from the sources.
4. If Langy should route to the new skill from user phrasing, add a row to the
   routing table in `services/langyagent/internal/assets/AGENTS.md`.
5. Run the fast structural tests, then the affected dogfood test locally
   (`_tests/README.md` — dogfood tests hit live LLMs and cost money; CI cannot
   gate on them, you must):
   ```bash
   cd skills
   npx vitest run _tests/native-skills.test.ts _tests/publish-sync.test.ts
   npx vitest run _tests/<skill>.scenario.test.ts
   ```

## Publishing

Merging to main publishes automatically (`skills-publish.yml`); bump
`version.txt` and add a `CHANGELOG.md` entry when the change is worth calling
out. The publisher wipes the target repo (everything but `.git`) and rewrites
it, so the public repo is always exactly this workspace's compiled view —
never edit langwatch/skills directly.
