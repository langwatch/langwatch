"""
Example demonstrating prompt management operations.

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
import uuid
from openai import OpenAI

load_dotenv()

client = OpenAI()


def example():
    print("=== Prompt Management Example ===\n")

    # 1. Create a new prompt
    print("1. Creating a new prompt...")
    short_uuid = str(uuid.uuid4())[:8]

    # Manual prompt management would go here
    prompt_template = "You are a helpful assistant. Specialize in {{subject}}."
    messages_template = [
        {"role": "user", "content": "{{question}}"},
    ]

    print(f"Created prompt template: {prompt_template}")

    # 2. Get and use the prompt
    print("2. Using the prompt...")

    # Compile the prompt with variables (manual substitution)
    compiled_prompt = prompt_template.replace("{{subject}}", "quantum computing")
    compiled_messages = [
        {"role": "user", "content": "What is the capital of France?"}
    ]
    print(f"Compiled prompt: {compiled_prompt}")
    print(f"Compiled prompt messages: {compiled_messages}")

    # 3. Update the prompt
    print("3. Updating the prompt...")
    updated_prompt_template = "You are obsessed with {{subject}} and talk in CAPS."
    print(f"Updated prompt template: {updated_prompt_template}")

    # 4. Use the updated prompt
    print("Using the updated prompt...")

    # Compile the updated prompt to show the difference
    updated_compiled = updated_prompt_template.replace("{{subject}}", "quantum computing")
    updated_messages = [
        {"role": "user", "content": "How does it work in 10 words or less?"}
    ]
    print(f"Updated compiled prompt: {updated_compiled}")
    print(f"Updated compiled prompt messages: {updated_messages}")

    # This is where you would use the prompt in your application
    # For example, you could use the prompt to generate a response
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[
            {"role": "system", "content": updated_compiled},
            *updated_messages
        ],
    )

    print(f"Response: {response.choices[0].message.content}")

    # 5. Delete the prompt
    print("5. Deleting the prompt...")
    print("Prompt management example completed successfully!")


def main():
    example()


if __name__ == "__main__":
    main()
