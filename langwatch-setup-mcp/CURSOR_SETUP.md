# Setting Up LangWatch Setup Assistant in Cursor

## 🚀 Quick Setup

### Step 1: Open Cursor Settings

- Press `Cmd + ,` (macOS) or `Ctrl + ,` (Windows/Linux)

### Step 2: Navigate to MCP

- Look for "MCP" or "Model Context Protocol" in the sidebar
- Click on it

### Step 3: Add LangWatch Setup Assistant

Add a new MCP server configuration:

```json
{
  "mcpServers": {
    "LangWatch Setup Assistant": {
      "command": "npx",
      "args": ["-y", "@langwatch/setup-mcp-server"]
    }
  }
}
```

### Step 4: Restart Cursor

Close and reopen Cursor for the changes to take effect.

## 🧪 Test the Integration

After restarting Cursor, open the chat (`Cmd + I`) and try these examples:

### Getting Started

```
"I want to integrate LangWatch into my Python app, how do I get started?"
```

### Specific Examples

```
"Show me how to integrate LangWatch with OpenAI in TypeScript"
```

### Troubleshooting

```
"My traces aren't appearing in LangWatch, what's wrong?"
```

### Understanding Concepts

```
"What's the difference between traces and spans in LangWatch?"
```

## 🛠️ Available Tools

The assistant will have access to these tools:

- **`get_setup_guide`** - Complete setup instructions for any language
- **`get_integration_example`** - Code examples for specific frameworks
- **`explain_concepts`** - Clear explanations of LangWatch concepts
- **`get_troubleshooting_help`** - Solutions for common issues
- **`get_evaluation_setup`** - Guide for setting up evaluations
- **`get_annotation_guide`** - Team collaboration features

## 🎯 Example Usage Scenarios

### New User Onboarding

**You:** "I'm completely new to LangWatch, walk me through the setup"
**Assistant:** Will use `get_setup_guide()` to provide comprehensive onboarding

### Framework-Specific Help

**You:** "I'm using FastAPI with Python, show me how to integrate LangWatch"  
**Assistant:** Will use `get_setup_guide(language="python", framework="fastapi")` and `get_integration_example()`

### Debugging Issues

**You:** "I set up LangWatch but no traces are showing in the dashboard"
**Assistant:** Will use `get_troubleshooting_help(issue="no_traces_appearing")`

### Learning Concepts

**You:** "I don't understand what threads and traces are"
**Assistant:** Will use `explain_concepts(concept="threads")` and `explain_concepts(concept="traces")`

## 🔧 Advanced Configuration

### Custom Endpoint (Self-Hosted)

If you're running a self-hosted LangWatch instance, you can add environment variables:

```json
{
  "mcpServers": {
    "LangWatch Setup Assistant": {
      "command": "npx",
      "args": ["-y", "@langwatch/setup-mcp-server"],
      "env": {
        "LANGWATCH_ENDPOINT": "https://your-langwatch-instance.com"
      }
    }
  }
}
```

### Debug Mode

Enable debug logging:

```json
{
  "mcpServers": {
    "LangWatch Setup Assistant": {
      "command": "npx",
      "args": ["-y", "@langwatch/setup-mcp-server", "--debug"]
    }
  }
}
```

## 🆘 Troubleshooting

### MCP Server Not Found

If you see "Tool not found" errors:

1. Make sure you've restarted Cursor
2. Check the MCP configuration syntax
3. Try running `npx @langwatch/setup-mcp-server` manually to test

### Network Issues

If the server fails to start:

1. Check your internet connection
2. Try clearing npm cache: `npm cache clean --force`
3. Update Node.js to version 18+

### Still Having Issues?

- 📧 Email: support@langwatch.ai
- 💬 Discord: https://discord.gg/kT4PhDS2gH
- 🐛 GitHub: https://github.com/langwatch/langwatch/issues

## 🎉 You're Ready!

Once configured, you'll have a powerful AI assistant that can help you:

- ✅ Set up LangWatch in any language/framework
- ✅ Provide working code examples
- ✅ Explain complex concepts clearly
- ✅ Troubleshoot integration issues
- ✅ Guide you through advanced features

Happy coding with LangWatch! 🚀
