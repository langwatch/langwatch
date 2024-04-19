---
title: Concepts
sidebar_position: 30
---

Understanding LangWatch concepts can be made easier with two practical examples: an AI travel assistant and a tool for generating blog posts. Let's dive into how each core concept of LangWatch applies to these examples.

Imagine you've created an AI travel assistant that helps users plan their trips by conversing with them to suggest destinations, find the best prices for flights, and assist with bookings. On the other hand, you also have a platform that assists users in generating, and refining blog posts, including SEO optimization.

### Traces

Field: `trace_id`

A **trace** in the travel assistant's framework is each distinct message as a whole, no matter how many chain steps it has inside. For example, when a user asks for the best prices to a destination, the trace would include the LLM suggestions, retrieval of options on API, and LLM generation of results. In the blog post tool, a trace could be for example each time the generation of a new catchy headline option, the generation of a draft for the body, or the SEO keywords generation. Each trace is a separate end-to-end generation handled by the AI.

The `trace_id` is by default randomly generated if you don't provide one, however, to keep control of your traces and connect them to events like [Thumbs Up/Down](./user-events/thumbs-up-down), we recommend generating a random id on your side, using, for example the [nanoid](https://pypi.org/project/nanoid/) library.

### Spans

Field: `span_id`

Within each trace, **spans** represent the individual steps taken to achieve the outcome. In the travel bot scenario, a span could be a call to the LLM to suggest potential destinations, another span for querying the airline price API, and a final span for formatting the response to present to the user. For the blog post tool, one span might be the initial text generation, followed by a subsequent span for LLM to self-critiquing the content, and another span for the third LLM call refining the text based on the critique.

### Threads

Field: `thread_id`

A **thread** in the context of the AI travel assistant represents a complete conversation, that is, the group of all traces. It's the entire chat that groups all back-and-forth messages as the user inquires about different aspects of their travel plan. For the blog post tool, a thread could be for example the creation process of a new blog post, encapsulating all interactions that contribute to its completion—from headline generation to the final SEO adjustments.

### User ID

Field: `user_id`

The **user id** identifies the ID of the final user of the product. In the context of both the AI travel assistant and the tool for generating blog posts, it's the ID that identifies the person using the app, usually their user account ID, this allows LangWatch to track how end users are using the product.

### Customer ID

Field: `customer_id`

The **customer id** is used when you provide a platform for your customers to build LLM apps for their end users. For example, it would be if your are building a platform that allow _others_ to build AI assistants for _their_ users. Having the **customer id** allows LangWatch to group all metrics and messages per customer, which allows you to access LangWatch data through our APIs to build a custom analytics dashboard for your customers, so they can see how their own LLM assistants are behaving.

### Labels

Field: `labels`

You can use **labels** to organize and compare the traces sent to LangWatch for any comparison you want to do. You can for example apply different labels for different actions, for example a label `blogpost_title` for generating the blog post title and another `blogpost_keywords`, for generating keywords. You can use it for versioning as well, for example label the first implementation
version as `v1.0.0`, then do a prompt engineering to improve the AI travel planner itenerary builder, and label it as `v1.0.1`. This way you can easily focus on each different functionality or compare versions on LangWatch dashboard.
