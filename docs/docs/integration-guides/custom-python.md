---
sidebar_position: 9
title: Custom Python Integration
---

# Custom Python Integration

Even if you have your own custom setup for calling LLMs and do not use any of the [other integrations](../category/integration-guides/) supported by LangWatch,
you can still use our Python SDK to help integrate with LangWatch.

### Prerequisites:

- Obtain your `LANGWATCH_API_KEY` from the LangWatch dashboard.

import { CustomPython } from "./CustomPython"

<CustomPython />

After following the above guide, your interactions with LLMs should now
be captured by LangWatch. Once integrated, you can visit your LangWatch
dashboard to view and analyze the traces collected from your
applications.