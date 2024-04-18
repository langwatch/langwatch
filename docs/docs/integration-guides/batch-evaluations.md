---
sidebar_position: 19
title: Batch Evaluations
---

# Batch Evaluations

If you intend to conduct batch evaluations on the datasets you've created in LangWatch, we offer a Python SKD to facilitate this process. This guide aims to provide comprehensive instructions on leveraging our Python SDK to execute batch evaluations effectively.

### Usage

After adding records to your dataset, created within the dataset section of LangWatch, you can proceed to select the dataset for batch evaluation along with the desired evaluations. You have the option to choose from predefined evaluations or any custom evaluations you've set up in the Evaluation and Guardrails section of LangWatch.

### Screenshots examples

In the below in screenshot you will see the datasets section in LangWatch, you can get your batch evaluation python snippet by clicking on on the Batch Evaluation button.

![langwatch dashboard](@site/static/img/screenshot-datasets-page.png)

In the below screenshot you will see where you can select the dataset you want to evaluate on as well as selecting which evaluations you would like to run. Each tab has different evaluation you can choose from.

![langwatch dashboard](@site/static/img/screenshot-batch-evaluation-drawer.png)

In the screenshot below, you'll find a Python code snippet ready for execution to perform your batch processing. The parameters passed into the `BatchEvaluation` include your chosen dataset and an array of selected evaluations to run against it.

![langwatch dashboard](@site/static/img/screenshot-batch-evaluation-python.png)

We've streamlined the process by setting up pandas for you, enabling seamless evaluation of datasets directly on the results object. This means you can leverage the power of pandas' data manipulation and analysis capabilities effortlessly within your evaluation workflow. With pandas at your disposal, you can efficiently explore, analyze, and manipulate your data to derive valuable insights without the need for additional setup or configuration.

### Python snippet

When executing the snippet, you'll encounter a callback function at your disposal. This function contains the original entry data, allowing you to run it against your own Large Language Model (LLM). You can utilize this response to compare results within your evaluation process.

Ensure that you return the `output` as some evaluations may require it. As you create your code snippet in the evaluations tab, you'll notice indications of which evaluations necessitate particular information. Utilize this guidance as a reference to kickstart your workflow effectively.
