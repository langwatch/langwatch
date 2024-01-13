---
sidebar_position: 3
title: REST API
---

# REST Endpoint Integration

If your preferred programming language or platform is not directly supported by the existing LangWatch libraries, you can use the REST API with `curl` to send trace data. This guide will walk you through how to integrate LangWatch with any system that allows HTTP requests.

import { CustomRest } from "./CustomRest"

<CustomRest />

After following the above guide, your interactions with LLMs should now
be captured by LangWatch. Once integrated, you can visit your LangWatch
dashboard to view and analyze the traces collected from your
applications.