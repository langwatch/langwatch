# Compiled Prompts

Pre-generated, self-contained prompts derived from `skills/*/SKILL.md` files. All file references (`_shared/`, `references/`) are inlined so the prompt can be used as-is.

## Files

Each skill has two versions:
- `*.platform.txt` -- API key placeholder `{{LANGWATCH_API_KEY}}` for platform pages (replace with the user's actual key)
- `*.docs.txt` -- Instructs the agent to ask the user for their API key (for documentation pages, links to https://app.langwatch.ai/authorize)

## Usage in Frontend

```typescript
const prompt = fs.readFileSync('skills/_compiled/create-agent.platform.txt', 'utf8');
const withKey = prompt.replace(/\{\{LANGWATCH_API_KEY\}\}/g, user.apiKey);
// Use as system prompt
```

## Regenerating

After modifying any `SKILL.md`, `_shared/*.md`, or `references/*.md` file:

```bash
bash skills/_compiled/generate.sh
```

Or compile a single skill:

```bash
npx tsx skills/_compiler/compile.ts --skills create-agent --mode platform
npx tsx skills/_compiler/compile.ts --skills create-agent --mode docs
```

## How the Compiler Works

1. Parses YAML frontmatter from `SKILL.md`
2. Resolves `[text](_shared/file.md)` and `[text](references/file.md)` links by inlining file content
3. Resolves cross-references within inlined content (e.g., shared files referencing other shared files)
4. Applies API key mode (platform: template placeholder, docs: ask-user instruction)
5. Wraps output in a system instruction envelope
