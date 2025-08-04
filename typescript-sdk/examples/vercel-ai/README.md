# Vercel AI Examples

This directory contains examples of AI apps built with the LangWatch SDK and Vercel AI.

## Example

### Basic Chatbot (`src/index.ts`)

A simple chatbot that handles basic conversation flow:

- **Features:**
  - Basic conversation loop
  - User input handling
  - AI response generation
  - Conversation history management
  - Error handling
  - Exit commands (`quit`, `exit`)

- **Usage:**
  ```bash
  npm run start
  ```

## Troubleshooting

### Common Issues:

1. **"Cannot find module 'langwatch/node'"**
   - Make sure you've built the LangWatch SDK
   - Check that the package is properly built

2. **OpenAI API errors**
   - Verify your API key is set correctly
   - Check your OpenAI account has sufficient credits

3. **TypeScript compilation errors**
   - Run `npm run start` to check for type errors
   - Ensure all dependencies are installed
