# Add URLs here from all old pages so we make sure they still exist or are redirected to a proper place and we don't break any links or get 404s on Google Search Console

urls="
/introduction
/self-hosting
/optimization-studio/overview
/optimization-studio/llm-nodes
/optimization-studio/datasets
/optimization-studio/evaluating
/optimization-studio/optimizing
/integration/overview
/integration/python/guide
/integration/python/reference
/integration/typescript/guide
/integration/opentelemetry/guide
/integration/langflow
/integration/flowise
/integration/rest-api
/integration/rags-context-tracking
/concepts
/integration/cookbooks
/integration/mcp
/evaluations/overview
/evaluations/custom-evaluator-integration
/guardrails/overview
/guardrails/setting-up-guardrails
/user-events/overview
/user-events/thumbs-up-down
/user-events/waited-to-finish
/user-events/selected-text
/user-events/custom
/dspy-visualization/quickstart
/dspy-visualization/custom-optimizer
/dspy-visualization/rag-visualization
/features/triggers
/features/annotations
/features/datasets
/features/embedded-analytics
/api-reference/traces/overview
/api-reference/traces/get-trace-details
/api-reference/traces/search-traces
/api-reference/traces/create-public-trace-path
/api-reference/traces/delete-public-trace-path
/api-reference/annotations/get-annotation
/api-reference/annotations/get-single-annotation
/api-reference/annotations/delete-annotation
/api-reference/annotations/patch-annotation
/api-reference/annotations/get-all-annotations-trace
/api-reference/annotations/create-annotation-trace
/api-reference/datasets/post-dataset-entries
/support
/status
/langevals/documentation/introduction
/langevals/documentation/evaluators
/langevals/documentation/unit-tests
/langevals/documentation/API-example
/langevals/how-to-choose-your-evaluator
/langevals/documentation/modular-architecture/contributing
/langevals/tutorials/extensive-unit-testing
/langevals/tutorials/rag-evaluation
/langevals/tutorials/ci-cd-pipeline-evaluation
/langevals/api-reference/endpoint/*
"

BASE_URL="http://localhost:3000"

for url in $urls; do
    full_url="$BASE_URL$url" # Construct the full URL using the correct variable 'url'
    # echo "Testing $full_url"
    # Capture both HTTP code and redirect URL, separated by a space
    output=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" "$full_url")
    # Split the output into http_code and redirect_url
    http_code=$(echo "$output" | cut -d' ' -f1)
    redirect_url=$(echo "$output" | cut -d' ' -f2)

    # Check the response code
    if [ "$http_code" -eq 200 ]; then
        # If status is 200, check for the meta description tag
        # Fetch page content and check for the meta tag quietly
        if curl -s "$full_url" | grep -q '<meta name="description"'; then
            # Meta tag found, success
            printf ""
        else
            # Meta tag NOT found
            echo "FAILED (Missing Meta Description): $full_url - Status code: $http_code"
        fi
    # Check if it's a redirect (status code starts with 3)
    elif [[ "$http_code" =~ ^3[0-9]{2}$ ]]; then
        # Extract the path from the redirect URL by removing the BASE_URL
        redirect_path=${redirect_url#"$BASE_URL"}
        # Check if redirect URL is not empty and the path is not /introduction
        if [ -n "$redirect_url" ] && [ "$redirect_path" != "/introduction" ]; then
            printf ""
        else
            # Fail if redirect is empty or targets /introduction
            echo "FAILED (Redirect): $full_url -> $redirect_url (Status: $http_code)"
        fi
    else
        # Handle other non-200 status codes
        echo "FAILED: $full_url - Status code: $http_code"
    fi
done

echo "Done"