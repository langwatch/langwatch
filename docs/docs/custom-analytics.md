---
title: Custom Analytics
sidebar_position: 5
---

# Custom Analytics with REST Endpoint

We've developed a specialized analytics endpoint that grants you access to the raw data underlying the graphs within our application. This guide will provide step-by-step instructions on utilizing the REST API to retrieve this data.

import { CustomRestAnalytics} from "./CustomRestAnalytics"

<CustomRestAnalytics />

## Screenshots on how to get the JSON data.

On the right menu button above the graph you will see the **Show API** menu link. Click that and a modal will then popup.

![langwatch dashboard](@site/static/img/screenshot-show-json.png)

Within this modal, you'll find the JSON payload required for the precise custom analytics data. Simply copy this payload and paste it into the body of your REST POST request.

![langwatch dashboard](@site/static/img/screenshot-json-modal.png)

Now you're fully prepared to access your customized analytics and seamlessly integrate them into your specific use cases.

If you encounter any hurdles or have questions, our support team is eager to assist you.
