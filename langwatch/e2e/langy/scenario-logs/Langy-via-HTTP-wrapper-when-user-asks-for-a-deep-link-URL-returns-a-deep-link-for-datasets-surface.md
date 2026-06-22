# Langy via HTTP wrapper > when user asks for a deep-link URL > returns a deep link for datasets surface

**Verdict:** PASS
**Generated:** 2026-05-27T13:17:27.397Z

## Judge reasoning

The assistant response in the transcript included the URL http://172.22.164.230:5560/datasets which contains 'datasets' in the path. The assistant did not ask the user which project; it directly provided dataset listings and the browse URL. Both criteria are satisfied.

## Criteria
- [x] Langy returns a URL that includes 'datasets' in the path.
- [x] Langy does not ask which project.

## Conversation

### user

where can I browse my datasets?

### assistant

- 3 datasets: failures-1779887735597 (0 records), langy-test-rows-1779887373236 (3), langy-scenario-test-1779887345656 (2)
- Browse datasets: http://172.22.164.230:5560/datasets
