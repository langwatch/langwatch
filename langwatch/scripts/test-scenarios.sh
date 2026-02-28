#!/bin/bash
# Quick test script to verify scenario execution is working
# Usage: ./scripts/test-scenarios.sh

set -e

echo "=== Scenario Execution Test ==="
echo ""

# Check if workers are running
echo "1. Checking workers..."
if docker ps | grep -q "langwatch-workers"; then
    echo "   ✓ Workers container is running"
else
    echo "   ✗ Workers container not found"
    echo "   Run: make dev-scenarios"
    exit 1
fi

# Check Redis container
echo ""
echo "2. Checking Redis..."
if docker ps | grep -q "langwatch-redis"; then
    REDIS_STATUS=$(docker ps --filter "name=langwatch-redis" --format "{{.Status}}")
    if echo "$REDIS_STATUS" | grep -q "healthy"; then
        echo "   ✓ Redis is healthy"
    else
        echo "   ✓ Redis is running ($REDIS_STATUS)"
    fi
else
    echo "   ✗ Redis container not found"
    exit 1
fi

# Check for scenario processor initialization
echo ""
echo "3. Checking scenario processor..."
if docker logs langwatch-workers-1 2>&1 | grep -iq "scenario\|simulations"; then
    echo "   ✓ Scenario processor found in logs"
else
    echo "   ? No scenario logs found (may be normal if no scenarios run yet)"
fi

# Check Bull Board
echo ""
echo "4. Checking Bull Board..."
BULLBOARD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "failed")
if [ "$BULLBOARD_STATUS" = "200" ] || [ "$BULLBOARD_STATUS" = "302" ]; then
    echo "   ✓ Bull Board is accessible at http://localhost:3000"
else
    echo "   ? Bull Board not accessible (status: $BULLBOARD_STATUS)"
fi

# Check app
echo ""
echo "5. Checking app..."
APP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5560 2>/dev/null || echo "failed")
if [ "$APP_STATUS" = "200" ] || [ "$APP_STATUS" = "302" ]; then
    echo "   ✓ App is accessible at http://localhost:5560"
else
    echo "   ? App may still be starting (status: $APP_STATUS)"
    echo "   Wait a moment and check http://localhost:5560"
fi

echo ""
echo "=== Checks Complete ==="
echo ""
echo "To test scenario execution:"
echo "1. Open http://localhost:5560"
echo "2. Create or select a project"
echo "3. Go to Scenarios"
echo "4. Create a scenario and run it"
echo "5. Check Bull Board at http://localhost:3000 for job status"
echo ""
echo "To check worker logs:"
echo "  docker logs -f langwatch-workers-1"
echo ""
