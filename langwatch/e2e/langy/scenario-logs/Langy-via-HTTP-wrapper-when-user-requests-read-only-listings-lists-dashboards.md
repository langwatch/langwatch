# Langy via HTTP wrapper > when user requests read-only listings > lists dashboards

**Verdict:** PASS
**Generated:** 2026-05-27T13:07:38.571Z

## Judge reasoning

The assistant responded to 'show my dashboards' with an explicit dashboard count ('3 dashboards'), listed the dashboard names and IDs, and provided a dashboards URL. This satisfies criterion 1. The response does not pivot to analytics or monitors or mention those features; it sticks to reporting dashboards, satisfying criterion 2.

## Criteria
- [x] Langy reports dashboard count or a clear empty-state.
- [x] Langy doesn't pivot to analytics or monitors.

## Conversation

### user

show my dashboards

### assistant

3 dashboards.

- Names: Reports, langy-test-dash-1779721580300, langy-test-dash-1779807467075
- IDs: Sce59lc4bc7Gk5NECdYQ8, 3mlBQbkUAN40Y-Ck2L6jH, ph14tOiN5iWaGJhU2Vskw

http://172.22.164.230:5560/dashboards
