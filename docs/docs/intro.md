---
title: "Introduction"
sidebar_position: 1
---

# Introduction

Welcome to LangWatch. Here we offer tools for the detailed observation and analysis of Large Language Models (LLMs). Our platform is designed for developers and data scientists who need to keep a close watch on the performance and behavior of their LLMs, ensuring their applications run smoothly and effectively.

## What is LangWatch?

LangWatch provides a set of tools tailored to enhance the visibility into the operation of LLMs. Currently, it supports OpenAI and LangChain integrations, with the goal of providing you with a transparent and controlled environment for your LLMs' interactions and outputs.

<!-- TODO: update screenshot -->

![langwatch screenshot](@site/static/img/screenshot-messages.png)

## Core Concepts

To make the most out of LangWatch, you'll need to be acquainted with several key concepts:

- **Span**: Spans are the individual operations or calls made to the LLM during a trace. In LangChain, for instance, each step in the chain is considered a span. Spans could include the generation of a response, summarization, or any transformation executed by the LLM.

- **Trace**: A trace, or message, represents the complete lifecycle of a single user interaction with your LLM, initial input and final output. Within this trace, you may find multiple 'spans', each representing a step in the conversation or a transformation performed by the LLM.

- **Thread**: This refers to a series of related traces that together form a conversation or a session. Threads help in grouping interactions, making it easier to analyze the flow and context of conversations with the LLM.

- **User**: Users are the end-users interacting with your LLM. By sending us user identifiers along with traces, LangWatch enables you to perform per-user analysis and obtain insights on individual user behaviors.

Read more on [concepts](./concepts).

## Supported LLMs

LangWatch's current integrations with OpenAI and LangChain are just the beginning. We're working to support more models and languages, aiming to offer a robust, expandable tool for a variety of LLM applications.

In this documentation, you'll find guides and examples on integrating LangWatch with your LLMs, understanding the output and data provided, and leveraging our tools to improve the functionality of your AI applications.

If you come across terms or processes that seem unclear, or if you're looking for how LangWatch applies to your specific context, we encourage you to contact us. Our goal is to provide a transparent, efficient, and effective experience that empowers you to achieve more with your LLMs.

Let's dive into the details of how LangWatch works and how you can integrate it into your LLM workflows.
