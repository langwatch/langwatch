# Handling LangWatch Plan Limits

LangWatch has usage limits on the free plan (e.g., limited number of prompts, scenarios, evaluators, experiments, datasets). When you hit a limit, the API returns an error like:

> "Free plan limit of 3 scenarios reached. To increase your limits, upgrade your plan at https://app.langwatch.ai/settings/subscription"

## How to Handle Limits

### During Onboarding / Initial Setup

When setting up LangWatch for the first time, focus on delivering VALUE before the user hits limits:

1. **Work within the limits.** If the free plan allows 3 scenario sets, create up to 3 meaningful ones — don't try to create 10.
2. **Make every creation count.** Each prompt, scenario, or evaluator you create should demonstrate clear value.
3. **Show the user what works FIRST.** Run the tests, show the results, let them see the value before they encounter any limits.
4. **Stop gracefully at the limit.** When you've used the available slots, tell the user what you accomplished and what they can do next.

### When You Hit a Limit

If you get a "plan limit reached" error:

1. **Do NOT try to work around the limit.** Do not reuse scenario sets to stuff more tests in, do not delete existing resources to make room, do not hack around it.
2. **Tell the user what happened clearly.** Explain that they've reached their free plan limit.
3. **Show the value you already delivered.** Summarize what was created and how it helps them.
4. **Suggest upgrading.** Direct them to upgrade at: https://app.langwatch.ai/settings/subscription
5. **Frame it positively.** "You've set up [X, Y, Z] which gives you [value]. To add more, you can upgrade your plan."

### Example Response When Hitting a Limit

Good:
> "I've created 3 scenario tests covering your agent's core flows: customer greeting, refund handling, and escalation. These are running and you can see results in your LangWatch dashboard. To add more scenarios (like edge cases and red teaming), you can upgrade your plan at https://app.langwatch.ai/settings/subscription"

Bad:
> "Error: limit reached. Let me try reusing an existing scenario set to add more tests..."

Bad:
> "You need to upgrade to continue. Visit https://app.langwatch.ai/settings/subscription"
> (No value shown first)
