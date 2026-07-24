from dotenv import load_dotenv
load_dotenv()

from openai import OpenAI

client = OpenAI()

KNOWLEDGE_BASE = """
# TerraVerde Farm Advisory Knowledge Base

## Irrigation Management
- Soil moisture threshold for apple orchards: maintain between 25-35 kPa
- Drip irrigation scheduling: adjust based on ET₀ (reference evapotranspiration)
- Deficit irrigation for cherries: reduce water 2 weeks before harvest to improve sugar content

## Frost Protection
- Critical temperature for apple blossoms: -2.2°C
- Wind machines activate at 0°C, overhead sprinklers at -1°C
- Inversion layer monitoring via IoT temperature sensors at 2m and 10m height

## Pest Management
- Codling moth monitoring: degree-day model, first spray at 250 DD after biofix
- Apple scab risk: Mills table — infection periods based on temperature and leaf wetness duration
- Integrated pest management: scout weekly, threshold-based spraying
"""

SYSTEM_PROMPT = f"""You are TerraVerde's farm advisory assistant. You help fruit growers
with irrigation, frost protection, pest management, and yield optimization decisions.

Use the following knowledge base to answer questions:
{KNOWLEDGE_BASE}

Always cite specific thresholds and protocols from the knowledge base.
If you don't know something, say so — don't make up agronomic advice."""


def chat(message: str, context: str = "") -> str:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
    ]
    if context:
        messages.append({"role": "user", "content": f"Context from sensors: {context}"})
    messages.append({"role": "user", "content": message})

    response = client.chat.completions.create(
        model="gpt-5-mini",
        messages=messages,
    )
    return response.choices[0].message.content


if __name__ == "__main__":
    print(chat("When should I start irrigating my apple orchard this spring?"))
