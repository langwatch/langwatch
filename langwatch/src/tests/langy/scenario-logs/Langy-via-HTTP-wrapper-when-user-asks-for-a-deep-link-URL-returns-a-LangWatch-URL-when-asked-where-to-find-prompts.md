# Langy via HTTP wrapper > when user asks for a deep-link URL > returns a LangWatch URL when asked where to find prompts

**Verdict:** PASS
**Generated:** 2026-05-27T13:17:00.673Z

## Judge reasoning

The assistant's response in the transcript included a concrete URL pointing to the prompts page: 'http://172.22.164.230:5560/prompts', satisfying criterion 1. The assistant did not give any vague instruction like 'go to settings'—it directly provided the Prompts page URL and listed prompts, satisfying criterion 2. The assistant also did not ask which project the user meant; it directly listed prompts, satisfying criterion 3. Therefore all three criteria are met.

## Criteria
- [x] Langy returns a concrete LangWatch URL including 'prompts' in the path.
- [x] Langy does not respond with vague 'go to settings' instructions.
- [x] Langy does not ask which project.

## Conversation

### user

where in LangWatch can I see my prompts?

### assistant

- Prompts page: http://172.22.164.230:5560/prompts
- 3 prompts found: langy-test-prompt-1779882985844 (v2), langy-test-prompt-1779807355405 (v3), langy-test-prompt-1779721422346 (v4)
