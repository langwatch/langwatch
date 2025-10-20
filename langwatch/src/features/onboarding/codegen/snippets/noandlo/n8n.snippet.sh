# Navigate to the n8n nodes directory
cd ~/.n8n/nodes

# Install the Langwatch n8n nodes
npm i @langwatch/n8n-observability @langwatch/n8n-nodes-langwatch

# Set the environment variables
export EXTERNAL_HOOK_FILES=$(node -e "console.log(require.resolve('@langwatch/n8n-observability/hooks'))")
export N8N_OTEL_SERVICE_NAME=<project_name>
export LANGWATCH_API_KEY=<api_key>

# Start n8n again
n8n start
