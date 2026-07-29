---
name: self-improve-langwatch
user-prompt: "Report a Langy or LangWatch product issue for improvement"
description: Lets platform super admins turn verified Langy and LangWatch product issues into reviewable fixes.
license: MIT
---

# Improve LangWatch

This skill is available only when `LANGY_IS_SUPER_ADMIN=true`. If that value is
not true, state that this workflow is restricted to platform super admins and
stop.

For a product issue, first inspect the concrete LangWatch evidence supplied by
the user. Locate the relevant implementation, make the smallest correct fix,
run focused verification, and open a reviewable pull request when requested.

Do not use this skill for customer-project changes or external infrastructure.
