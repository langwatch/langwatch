# Compiled Prompts

Pre-generated copy-paste prompts derived from `skills/*/SKILL.md` files. These are ready for the onboarding frontend to consume.

## Files

Each skill has two versions:
- `*.platform.txt` — API key placeholder `{{LANGWATCH_API_KEY}}` for platform pages (replace with user's actual key)
- `*.docs.txt` — Tells the agent to ask the user for their API key (for documentation pages)

## Usage in Frontend

```typescript
const prompt = fs.readFileSync('skills/_compiled/tracing.platform.txt', 'utf8');
const withKey = prompt.replace(/\{\{LANGWATCH_API_KEY\}\}/g, user.apiKey);
// Show in copy-paste UI
```

## Regenerating

After modifying any `SKILL.md` or `_shared/*.md` file:

```bash
bash skills/_compiled/generate.sh
```

## No Separate Tests Needed

Compiled prompts are the same content as the SKILL.md with `_shared/` references inlined. If the skill's scenario test passes, the compiled version works too.
