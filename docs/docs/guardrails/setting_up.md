---
sidebar_position: 1
title: Setting up Guardrails
---

Guardrails are protections you can add around your LLM calls, either before calling the LLM, for example to prevent jailbreaking; after calling an LLM, for example to verify if the generated output does not contain toxic language or leaking PII; or to steer the LLM in a different direction, for example when detecting a user is going off-topic or talking about competition, in which you might want to throw them in a different flow.

Setting up Guardrails is quite easy, first, go to the Evaluation and Guardrails area on your [LangWatch dashboard](https://app.langwatch.ai), press + Add, and look for evaluators with the shield icon, those evaluators are the ones that support acting as Guardrails:

![guardrails](@site/static/img/guardrails.png)

Then, toggle the "Use it as Guardrail", on the page itself, you will see the instructions on how to integrate the guardrail to your code, after following the instructions, don't forget to click "Save" to create the Guardrail before trying it out.

![enable guardrails](@site/static/img/enable-guardrails.png)

Back to the Guardrail setup, you can also try it out on the messages already on LangWatch, to verify if the Guardrail is working well, of it some adjustments are needed, using the Try it out section:

![try it out](@site/static/img/guardrails-try-it-out.png)

You are now ready to keep your LLM protected and steer the conversation in the right direction with LangWatch Guardrails! Follow the next guides for examples on how to use Guardrails for handling different situations, and more advanced use cases.

## What's next?

- (In progress) Using guardrails to prevent bad inputs from the LLM
- (In progress) Using guardrails to prevent bad outputs from the LLM to the user
- (In progress) Steering the conversation with another LLM call from the guardrail
- (In progress) Handling multiple guardrail calls in parallel
- (In progress) Speculative execution of the LLM in parallel to the guardrail call
