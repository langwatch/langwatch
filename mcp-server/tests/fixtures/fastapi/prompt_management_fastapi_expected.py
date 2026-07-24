"""
Example demonstrating LangWatch prompt management operations.

This example shows how to:
1. Create a new prompt
2. Retrieve and use a prompt
3. Update a prompt
4. Use the updated prompt
5. Delete a prompt

Run this example with:
    python examples/prompt_management.py
"""

from dotenv import load_dotenv
import langwatch
import uuid
from openai import OpenAI

load_dotenv()

client = OpenAI()

# Initialize LangWatch (ensure you have LANGWATCH_API_KEY set)
langwatch.setup(debug=True)


@langwatch.span()
def example():
    # Autotrack OpenAI calls
    langwatch.get_current_trace().autotrack_openai_calls(client)

    print("=== LangWatch Prompt Management Example ===\n")

    # 1. Create a new prompt
    print("1. Creating a new prompt...")
    short_uuid = str(uuid.uuid4())[:8]
    prompt = langwatch.prompts.create(
        handle=f"something/example_prompt_{short_uuid}",
        scope="PROJECT",  # optional - 'ORGANIZATION' or 'PROJECT'
        author_id=None,  # optional
        prompt="You are a helpful assistant. Specialize in {{subject}}.",  # optional
        messages=[  # optional -- you cannot set a system message and a prompt at the same time
            {"role": "user", "content": "{{question}}"},
        ],
        inputs=[{"identifier": "question", "type": "str"}],  # optional
        outputs=[
            {"identifier": "answer", "type": "str", "json_schema": {"type": "str"}}
        ],  # optional
    )
    print(f"Created prompt with id: {prompt.id}")
    print(f"Created prompt with handle: {prompt.handle}")

    # 2. Get and use the prompt
    print("2. Retrieving the prompt...")
    retrieved_prompt_specific_version = langwatch.prompts.get(
        prompt.handle, version_number=prompt.version_number
    )
    print(f"Retrieved prompt: {retrieved_prompt_specific_version.version_number}")

    # Use the prompt (example usage)
    print("Using the created prompt...")

    # Compile the prompt with variables
    compiled_prompt = retrieved_prompt.compile(
        question="What is the capital of France?"
    )
    print(f"Compiled prompt: {compiled_prompt.prompt}")
    print(f"Compiled prompt messages: {compiled_prompt.messages}")

    # 3. Update the prompt
    print("3. Updating the prompt...")
    updated_prompt = langwatch.prompts.update(
        prompt.handle,
        handle=f"updated_example_prompt_{short_uuid}",  # optional
        scope="PROJECT",  # optional - 'ORGANIZATION' or 'PROJECT'
        prompt="You are obsessed with {{subject}} and talk in CAPS.",  # optional
    )
    print(f"Updated prompt name: {updated_prompt.name}")
    print(f"Prompt ID remains: {updated_prompt.id}")

    # 4. Use the updated prompt
    print("Using the updated prompt...")

    # Compile the updated prompt to show the difference
    updated_compiled = updated_prompt.compile_strict(
        subject="quantum computing", question="How does it work in 10 words or less?"
    )
    print(f"Updated compiled prompt: {updated_compiled.prompt}")
    print(f"Updated compiled prompt messages: {updated_compiled.messages}")

    # This is where you would use the prompt in your application
    # For example, you could use the prompt to generate a response
    response = client.chat.completions.create(
        model=updated_compiled.model.split("openai/")[1],
        messages=updated_compiled.messages,
    )

    print(f"Response: {response.choices[0].message.content}")

    # 5. Delete the prompt
    print("5. Deleting the prompt...")
    result = langwatch.prompts.delete(updated_prompt.handle)
    print(f"Deletion result: {result}")
    print("Prompt management example completed successfully!")


@langwatch.trace()
def main():
    example()


if __name__ == "__main__":
    main()
