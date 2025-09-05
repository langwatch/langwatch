#!/usr/bin/env python3
"""
Script to generate a dataset with LangWatch code examples and their corresponding
versions without LangWatch instrumentation.

This script:
1. Collects LangWatch integration examples from the MCP server
2. Uses an LLM to transform the examples by removing LangWatch-specific code
3. Creates a CSV dataset with 'expected_output' (with LangWatch) and 'input' (without LangWatch) columns
"""

import os
import csv
import json
from typing import List
from dataclasses import dataclass
from openai import OpenAI

@dataclass
class CodeExample:
    language: str
    integration_type: str
    title: str
    code_with_langwatch: str
    code_without_langwatch: str = ""

class LangWatchDatasetGenerator:
    def __init__(self, openai_api_key: str = None):
        """Initialize the dataset generator with OpenAI client."""
        self.client = OpenAI(api_key=openai_api_key or os.getenv("OPENAI_API_KEY"))
        self.examples = []
        
        # Predefined examples from the MCP server
        self.langwatch_examples = [
            {
                "language": "python",
                "integration_type": "openai",
                "title": "Python OpenAI Integration",
                "code": '''import langwatch
import openai
import os

# Setup
langwatch.setup(api_key=os.getenv("LANGWATCH_API_KEY"))
client = openai.OpenAI()

@langwatch.trace()
def openai_chat(messages: list, user_id: str = None):
    # Start an LLM span
    with langwatch.span(type="llm") as span:
        span.update(
            name="openai_chat",
            input=messages,
            model="gpt-4"
        )
        
        # Make OpenAI call
        response = client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            temperature=0.7
        )
        
        # Update span with results
        span.update(
            output=response.choices[0].message.content,
            metrics={
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_cost": response.usage.total_tokens * 0.00003  # example pricing
            }
        )
        
        return response.choices[0].message.content

# Usage
messages = [{"role": "user", "content": "Hello!"}]
result = openai_chat(messages, user_id="user123")'''
            },
            {
                "language": "python",
                "integration_type": "basic",
                "title": "Python Basic Integration",
                "code": '''import langwatch
import os

# Setup
langwatch.setup(api_key=os.getenv("LANGWATCH_API_KEY"))

@langwatch.trace()
def chat_with_user(user_input: str, user_id: str = None):
    # This automatically creates a trace
    
    # Add metadata
    langwatch.get_current_trace().update(
        user_id=user_id,
        metadata={"source": "web_chat"}
    )
    
    # Your LLM logic here
    response = f"Response to: {user_input}"
    
    return response

# Usage
result = chat_with_user("What's the weather?", user_id="user123")'''
            },
            {
                "language": "typescript",
                "integration_type": "openai",
                "title": "TypeScript OpenAI Integration",
                "code": '''import { LangWatch } from "langwatch";
import OpenAI from "openai";

const langwatch = new LangWatch({
  apiKey: process.env.LANGWATCH_API_KEY!
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

async function openaiChat(messages: any[], userId?: string) {
  const trace = langwatch.startTrace({
    user_id: userId,
    thread_id: `conversation-${Date.now()}`
  });

  const span = trace.startLLMSpan({
    name: "openai_chat",
    input: messages,
    model: "gpt-4"
  });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages,
      temperature: 0.7
    });

    const content = response.choices[0].message.content;
    
    span.end({
      output: content,
      metrics: {
        prompt_tokens: response.usage?.prompt_tokens,
        completion_tokens: response.usage?.completion_tokens,
        total_cost: (response.usage?.total_tokens || 0) * 0.00003
      }
    });

    return content;
  } catch (error) {
    span.end({ error: error.message });
    throw error;
  } finally {
    trace.end();
  }
}

// Usage
const messages = [{ role: "user", content: "Hello!" }];
const result = await openaiChat(messages, "user123");'''
            },
            {
                "language": "python",
                "integration_type": "evaluation",
                "title": "Python Evaluation Integration",
                "code": '''import langwatch
import os

# Setup
langwatch.setup(api_key=os.getenv("LANGWATCH_API_KEY"))

@langwatch.trace()
def llm_with_evaluation(user_input: str):
    # Your LLM call
    response = "Generated response"
    
    # Add custom evaluation
    langwatch.get_current_span().add_evaluation(
        name="response_quality",
        passed=True,
        score=0.85,
        label="high_quality",
        details="Response is relevant and helpful"
    )
    
    # You can also add evaluations to the trace level
    langwatch.get_current_trace().add_evaluation(
        name="conversation_flow",
        passed=True,
        score=0.9
    )
    
    return response

result = llm_with_evaluation("What's AI?")'''
            },
            {
                "language": "typescript",
                "integration_type": "basic",
                "title": "TypeScript Basic Integration",
                "code": '''import { LangWatch } from "langwatch";

const langwatch = new LangWatch({
  apiKey: process.env.LANGWATCH_API_KEY!
});

async function chatWithUser(userInput: string, userId?: string) {
  const trace = langwatch.startTrace({
    user_id: userId,
    metadata: { source: "web_chat" }
  });

  const span = trace.startLLMSpan({
    name: "chat_response",
    input: userInput,
    model: "gpt-4"
  });

  try {
    // Your LLM logic here
    const response = `Response to: ${userInput}`;
    
    span.end({ output: response });
    return response;
  } catch (error) {
    span.end({ error: error.message });
    throw error;
  } finally {
    trace.end();
  }
}

// Usage
const result = await chatWithUser("What's the weather?", "user123");'''
            }
        ]

    def remove_langwatch_instrumentation(self, code_with_langwatch: str, language: str) -> str:
        """Use OpenAI to remove LangWatch instrumentation from code."""
        
        system_prompt = f"""You are a code transformation expert. Your task is to remove LangWatch monitoring and tracing instrumentation from {language} code while preserving the core functionality.

Remove the following LangWatch-specific elements:
1. All LangWatch imports (langwatch, LangWatch)
2. langwatch.setup() calls
3. @langwatch.trace() decorators
4. langwatch.span() context managers and span operations
5. langwatch.startTrace(), trace.startLLMSpan(), span.end(), trace.end() calls
6. langwatch.get_current_trace() and langwatch.get_current_span() calls
7. Any LangWatch-specific metadata, evaluations, or metrics
8. LangWatch client initialization

Keep the following:
1. Core business logic and LLM API calls
2. Function signatures and parameters (but remove LangWatch-specific ones like user_id if not used elsewhere)
3. Error handling (but remove LangWatch-specific error reporting)
4. Return values and response processing
5. Comments that explain business logic (remove LangWatch-specific comments)

The resulting code should be clean, functional, and ready to run without any LangWatch dependencies."""

        user_prompt = f"""Transform this {language} code by removing all LangWatch instrumentation:

```{language}
{code_with_langwatch}
```

Return only the transformed code without any explanations or markdown formatting."""

        try:
            response = self.client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.1,
                max_tokens=2000
            )
            
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"Error calling OpenAI API: {e}")
            return ""

    def generate_examples(self) -> List[CodeExample]:
        """Generate code examples with and without LangWatch instrumentation."""
        examples = []
        
        for example_data in self.langwatch_examples:
            print(f"Processing {example_data['title']}...")
            
            # Remove LangWatch instrumentation
            code_without_langwatch = self.remove_langwatch_instrumentation(
                example_data['code'], 
                example_data['language']
            )
            
            if code_without_langwatch:
                example = CodeExample(
                    language=example_data['language'],
                    integration_type=example_data['integration_type'],
                    title=example_data['title'],
                    code_with_langwatch=example_data['code'],
                    code_without_langwatch=code_without_langwatch
                )
                examples.append(example)
                print(f"✓ Successfully processed {example_data['title']}")
            else:
                print(f"✗ Failed to process {example_data['title']}")
        
        return examples

    def save_to_csv(self, examples: List[CodeExample], filename: str = "langwatch_dataset.csv"):
        """Save the dataset to a CSV file."""
        with open(filename, 'w', newline='', encoding='utf-8') as csvfile:
            fieldnames = ['title', 'language', 'integration_type', 'input', 'expected_output']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            
            writer.writeheader()
            for example in examples:
                writer.writerow({
                    'title': example.title,
                    'language': example.language,
                    'integration_type': example.integration_type,
                    'input': example.code_without_langwatch,
                    'expected_output': example.code_with_langwatch
                })
        
        print(f"Dataset saved to {filename}")

    def save_to_json(self, examples: List[CodeExample], filename: str = "langwatch_dataset.json"):
        """Save the dataset to a JSON file."""
        data = []
        for example in examples:
            data.append({
                'title': example.title,
                'language': example.language,
                'integration_type': example.integration_type,
                'input': example.code_without_langwatch,
                'expected_output': example.code_with_langwatch
            })
        
        with open(filename, 'w', encoding='utf-8') as jsonfile:
            json.dump(data, jsonfile, indent=2, ensure_ascii=False)
        
        print(f"Dataset saved to {filename}")

    def generate_dataset(self, output_format: str = "both"):
        """Generate the complete dataset."""
        print("Starting LangWatch dataset generation...")
        print(f"Found {len(self.langwatch_examples)} examples to process")
        
        # Generate examples
        examples = self.generate_examples()
        
        if not examples:
            print("No examples were successfully generated!")
            return
        
        print(f"\nSuccessfully generated {len(examples)} examples")
        
        # Save to files
        if output_format in ["csv", "both"]:
            self.save_to_csv(examples)
        
        if output_format in ["json", "both"]:
            self.save_to_json(examples)
        
        # Print summary
        print(f"\nDataset Summary:")
        print(f"Total examples: {len(examples)}")
        
        language_counts = {}
        integration_counts = {}
        
        for example in examples:
            language_counts[example.language] = language_counts.get(example.language, 0) + 1
            integration_counts[example.integration_type] = integration_counts.get(example.integration_type, 0) + 1
        
        print(f"Languages: {dict(language_counts)}")
        print(f"Integration types: {dict(integration_counts)}")

def main():
    """Main function to run the dataset generator."""
    # Check for OpenAI API key
    if not os.getenv("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY environment variable is required")
        print("Please set it with: export OPENAI_API_KEY='your-api-key'")
        return
    
    # Generate dataset
    generator = LangWatchDatasetGenerator()
    generator.generate_dataset()

if __name__ == "__main__":
    main()
