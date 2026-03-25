---
name: evaluate-multimodal
description: Evaluate multimodal AI agents that process images, audio, PDFs, or other files. Sets up evaluations using LangWatch's LLM-as-judge with image inputs, Scenario's multimodal testing, and document parsing evaluation patterns. Use when your agent handles non-text inputs.
license: MIT
compatibility: Requires LangWatch SDK and optionally @langwatch/scenario. Works with Claude Code and similar coding agents.
metadata:
  category: recipe
---

# Evaluate Your Multimodal Agent

This recipe helps you evaluate agents that process images, audio, PDFs, or other non-text inputs.

## Step 1: Identify Modalities

Read the codebase to understand what your agent processes:
- **Images**: classification, analysis, generation, OCR
- **Audio**: transcription, voice agents, audio Q&A
- **PDFs/Documents**: parsing, extraction, summarization
- **Mixed**: multiple input types in one pipeline

## Step 2: Read the Relevant Docs

Use the LangWatch MCP:
- `fetch_scenario_docs` → search for multimodal pages (image analysis, audio testing, file analysis)
- `fetch_langwatch_docs` → search for evaluation SDK docs

For PDF evaluation specifically, reference the pattern from `python-sdk/examples/pdf_parsing_evaluation.ipynb`:
- Download/load documents
- Define extraction pipeline
- Use LangWatch experiment SDK to evaluate extraction accuracy

## Step 3: Ensure Evaluators Exist on the Platform

Before writing experiment code, set up the evaluators you will use:

1. Call `platform_list_evaluators` to see what already exists
2. If no suitable evaluator exists, call `platform_create_evaluator` to create one (e.g., `llm_boolean` for pass/fail judgments)
3. Note the returned slug — use it exactly in your experiment code

Also verify a model provider is configured via `platform_list_model_providers`. If none, set one up with `platform_set_model_provider`.

## Step 4: Set Up Evaluation by Modality

### Image Evaluation
LangWatch's LLM-as-judge evaluators can accept images. Create an evaluation that:
1. Loads test images
2. Runs the agent on each image
3. Uses an LLM-as-judge evaluator to assess output quality

```python
import langwatch

experiment = langwatch.experiment.init("image-eval")

for idx, entry in experiment.loop(enumerate(image_dataset)):
    result = my_agent(image=entry["image_path"])
    experiment.evaluate(
        "llm_boolean",
        index=idx,
        data={
            "input": entry["image_path"],  # LLM-as-judge can view images
            "output": result,
        },
        settings={
            "model": "openai/gpt-5-mini",
            "prompt": "Does the agent correctly describe/classify this image?",
        },
    )
```

### Audio Evaluation
Use Scenario's audio testing patterns:
- Audio-to-text: verify transcription accuracy
- Audio-to-audio: verify voice agent responses
- Use `fetch_scenario_docs` with url for `multimodal/audio-to-text.md`

### PDF/Document Evaluation
Follow the pattern from the PDF parsing evaluation example:
1. Load documents (PDFs, CSVs, etc.)
2. Define extraction/parsing pipeline
3. Evaluate extraction accuracy against expected fields
4. Use structured evaluation (exact match for fields, LLM judge for summaries)

### File Analysis
For agents that process arbitrary files:
- Use Scenario's file analysis patterns
- `fetch_scenario_docs` with url for `multimodal/multimodal-files.md`

## Step 5: Generate Domain-Specific Test Data

For each modality, generate or collect test data that matches the agent's actual use case:
- If it's a medical imaging agent → use relevant medical image samples
- If it's a document parser → use real document types the agent encounters
- If it's a voice assistant → record realistic voice prompts

## Step 6: Run and Iterate

Run the evaluation, review results, fix issues, re-run until quality is acceptable.

## Common Mistakes
- Do NOT evaluate multimodal agents with text-only metrics — use image-aware judges
- Do NOT skip testing with real file formats — synthetic descriptions aren't enough
- Do NOT forget to handle file loading errors in evaluations
- Do NOT use generic test images — use domain-specific ones matching the agent's purpose
