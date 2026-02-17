"""
Metadata and Labels Example

Demonstrates ALL metadata fields supported by LangWatch:
- thread_id: Groups messages in a conversation
- user_id: Identifies the end user
- customer_id: Identifies your customer/tenant
- labels: Categorization tags
- Custom metadata: Any additional context

Run: python metadata_example.py
"""

import os
import uuid
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

from openai import OpenAI
import langwatch

client = OpenAI()


def handle_user_message(
    message: str,
    user_id: str,
    customer_id: str,
    thread_id: str,
    user_tier: str = "free",
    environment: str = "development",
) -> str:
    """
    Process a user message with full metadata tracking.
    
    All metadata is set via langwatch.get_current_trace().update()
    """
    
    @langwatch.trace()
    def _process():
        trace = langwatch.get_current_trace()
        trace.autotrack_openai_calls(client)
        
        # Set all metadata fields
        trace.update(
            metadata={
                # =========================================
                # Core Identification Fields
                # =========================================
                
                # Thread ID: Groups messages in a conversation
                # All traces with the same thread_id appear together
                "thread_id": thread_id,
                
                # User ID: Identifies the end user
                # Enables user-level analytics and filtering
                "user_id": user_id,
                
                # Customer ID: Identifies your customer/tenant
                # Useful for multi-tenant applications
                "customer_id": customer_id,
                
                # =========================================
                # Labels (for filtering and categorization)
                # =========================================
                
                # Labels are an array of strings
                # Use for environment, tiers, features, etc.
                "labels": [
                    environment,
                    f"tier-{user_tier}",
                    "openai",
                    "example",
                ],
                
                # =========================================
                # Custom Metadata (any additional context)
                # =========================================
                
                # Any other fields become custom metadata
                # Available for filtering and display in dashboard
                "request_timestamp": datetime.now().isoformat(),
                "sdk_version": "1.0.0",
                "feature_flags": ["new-model-v2", "streaming"],
                "user_tier": user_tier,
            }
        )
        
        print(f"📊 Sending request with metadata:")
        print(f"   User: {user_id}")
        print(f"   Customer: {customer_id}")
        print(f"   Thread: {thread_id}")
        print(f"   Labels: {environment}, tier-{user_tier}")
        print()
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant. Be concise.",
                },
                {"role": "user", "content": message},
            ],
        )
        
        return response.choices[0].message.content
    
    return _process()


def main():
    print("🏷️  LangWatch Metadata Example (Python)\n")
    print("This example demonstrates all metadata fields:")
    print("  • thread_id - Thread/conversation grouping")
    print("  • user_id - User identification")
    print("  • customer_id - Customer/tenant identification")
    print("  • labels - Categorization tags")
    print("  • Custom fields - Any additional context\n")
    print("=" * 50 + "\n")
    
    # Simulate a user context (in real apps, from auth/session)
    user_id = "user-12345"
    customer_id = "acme-corp"
    thread_id = f"conv-{uuid.uuid4().hex[:8]}"
    
    # First message in conversation
    print("User: What is the capital of France?\n")
    response1 = handle_user_message(
        message="What is the capital of France?",
        user_id=user_id,
        customer_id=customer_id,
        thread_id=thread_id,
        user_tier="pro",
        environment="development",
    )
    print(f"Assistant: {response1}\n")
    
    # Second message in same conversation (same thread_id)
    print("User: What about Germany?\n")
    response2 = handle_user_message(
        message="What about Germany?",
        user_id=user_id,
        customer_id=customer_id,
        thread_id=thread_id,  # Same thread_id groups messages
        user_tier="pro",
        environment="development",
    )
    print(f"Assistant: {response2}\n")
    
    print("=" * 50)
    print("\n✅ Check your LangWatch dashboard to see:")
    print("   • Both messages grouped under the same thread")
    print("   • User and customer IDs for filtering")
    print("   • Labels for categorization")
    print("   • Custom metadata in the trace details\n")


if __name__ == "__main__":
    main()
