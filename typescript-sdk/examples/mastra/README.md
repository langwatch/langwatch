# Mastra Weather Agent Example

This example demonstrates how to use LangWatch with Mastra to create a weather agent that can provide weather information and suggest activities based on weather conditions.

## Features

- **Weather Agent**: An AI agent that can fetch weather data and suggest activities
- **Weather Tool**: A tool that fetches real-time weather data from Open-Meteo API
- **CLI Chatbox Interface**: Interactive command-line interface for chatting with the weather agent
- **LangWatch Integration**: Full observability and tracing with LangWatch

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up your environment variables:
   ```bash
   cp .env.example .env
   # Add your OpenAI API key to .env
   ```

3. Run the CLI chatbox interface:
   ```bash
   npm run cli
   ```

4. Or run the workflow example:
   ```bash
   npm start
   ```

## Usage

### CLI Chatbox Interface

The CLI interface allows you to interact with the weather agent in a conversational manner:

```bash
npm run cli
```

Example conversation:
```
🌤️  Weather Agent Chatbot started! Type "quit" to exit.
Ask me about weather for any location and I'll help you plan activities!
---
You: What's the weather like in Paris?
🌤️  Checking weather and planning activities...
[Agent responds with weather information and activity suggestions]
```

### Workflow Example

The workflow example demonstrates how to use Mastra workflows to fetch weather data and plan activities programmatically.
