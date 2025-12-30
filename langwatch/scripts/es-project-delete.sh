#!/bin/bash
# Elasticsearch Project Data Deletion Script
# Usage:
#   Dry run (default):  ./scripts/es-project-delete.sh <project_id>
#   Execute deletion:   ./scripts/es-project-delete.sh <project_id> --execute
#   Multiple projects:  ./scripts/es-project-delete.sh <project_id1,project_id2,...>
#
# Required env vars:
#   ELASTICSEARCH_NODE_URL - ES endpoint (e.g., http://localhost:9200)
#   ELASTICSEARCH_API_KEY  - API key (optional, depends on ES config)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# Parse arguments
PROJECT_IDS=""
EXECUTE_MODE=false

for arg in "$@"; do
    case $arg in
        --execute)
            EXECUTE_MODE=true
            ;;
        *)
            if [ -z "$PROJECT_IDS" ]; then
                PROJECT_IDS="$arg"
            fi
            ;;
    esac
done

if [ -z "$PROJECT_IDS" ]; then
    echo -e "${RED}Error: Project ID(s) required${NC}"
    echo "Usage: $0 <project_id> [--execute]"
    echo "       $0 <project_id1,project_id2,...> [--execute]"
    echo ""
    echo "Options:"
    echo "  --execute    Actually perform the deletion (default is dry-run)"
    echo ""
    echo "Required environment variables:"
    echo "  ELASTICSEARCH_NODE_URL - ES endpoint (e.g., http://localhost:9200)"
    echo "  ELASTICSEARCH_API_KEY  - API key (optional)"
    exit 1
fi

if [ -z "$ELASTICSEARCH_NODE_URL" ]; then
    echo -e "${RED}Error: ELASTICSEARCH_NODE_URL environment variable is not set${NC}"
    exit 1
fi

# ES indexes to query
TRACE_INDEX="search-traces-*"
DSPY_INDEX="search-dspy-steps-alias"
BATCH_EVAL_INDEX="search-batch-evaluations-alias"
SCENARIO_INDEX="scenario-events-alias"

# Create reports directory
REPORTS_DIR="$(dirname "$0")/../reports"
mkdir -p "$REPORTS_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="${REPORTS_DIR}/es_deletion_${TIMESTAMP}.txt"

# Logging function
log() {
    echo -e "$1" | tee -a "$REPORT_FILE"
}

# Function to query ES count
es_count() {
    local index="$1"
    local query="$2"
    local result
    
    if [ -n "$ELASTICSEARCH_API_KEY" ]; then
        result=$(curl -s -X POST "$ELASTICSEARCH_NODE_URL/${index}/_count" \
            -H "Authorization: ApiKey $ELASTICSEARCH_API_KEY" \
            -H 'Content-Type: application/json' \
            -d "$query" 2>/dev/null)
    else
        result=$(curl -s -X POST "$ELASTICSEARCH_NODE_URL/${index}/_count" \
            -H 'Content-Type: application/json' \
            -d "$query" 2>/dev/null)
    fi
    
    echo "$result" | grep -o '"count":[0-9]*' | cut -d: -f2 || echo "0"
}

# Function to query ES for document IDs
es_get_ids() {
    local index="$1"
    local query="$2"
    local size="${3:-100}"
    local result
    
    if [ -n "$ELASTICSEARCH_API_KEY" ]; then
        result=$(curl -s -X POST "$ELASTICSEARCH_NODE_URL/${index}/_search?size=${size}" \
            -H "Authorization: ApiKey $ELASTICSEARCH_API_KEY" \
            -H 'Content-Type: application/json' \
            -d "$query" 2>/dev/null)
    else
        result=$(curl -s -X POST "$ELASTICSEARCH_NODE_URL/${index}/_search?size=${size}" \
            -H 'Content-Type: application/json' \
            -d "$query" 2>/dev/null)
    fi
    
    echo "$result" | grep -o '"_id":"[^"]*"' | cut -d'"' -f4
}

# Function to delete by query
es_delete_by_query() {
    local index="$1"
    local query="$2"
    
    if [ -n "$ELASTICSEARCH_API_KEY" ]; then
        curl -s -X POST "$ELASTICSEARCH_NODE_URL/${index}/_delete_by_query?conflicts=proceed" \
            -H "Authorization: ApiKey $ELASTICSEARCH_API_KEY" \
            -H 'Content-Type: application/json' \
            -d "$query" 2>/dev/null
    else
        curl -s -X POST "$ELASTICSEARCH_NODE_URL/${index}/_delete_by_query?conflicts=proceed" \
            -H 'Content-Type: application/json' \
            -d "$query" 2>/dev/null
    fi
}

# Build the project ID filter (supports multiple IDs)
IFS=',' read -ra PROJECT_ID_ARRAY <<< "$PROJECT_IDS"
PROJECT_FILTER_TERMS=""
for pid in "${PROJECT_ID_ARRAY[@]}"; do
    if [ -n "$PROJECT_FILTER_TERMS" ]; then
        PROJECT_FILTER_TERMS="${PROJECT_FILTER_TERMS},"
    fi
    PROJECT_FILTER_TERMS="${PROJECT_FILTER_TERMS}\"$pid\""
done

QUERY_BODY="{\"query\":{\"terms\":{\"project_id\":[${PROJECT_FILTER_TERMS}]}}}"

# ============================================================
# HEADER
# ============================================================
log "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
log "${BOLD}${CYAN}║      ELASTICSEARCH PROJECT DATA DELETION REPORT             ║${NC}"
log "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
log ""
log "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
log "ES URL: $ELASTICSEARCH_NODE_URL"
log "Mode: $([ "$EXECUTE_MODE" = true ] && echo "${RED}EXECUTE${NC}" || echo "${GREEN}DRY RUN${NC}")"
log ""

log "${BOLD}${YELLOW}>> TARGET PROJECTS${NC}"
for pid in "${PROJECT_ID_ARRAY[@]}"; do
    log "  - $pid"
done
log ""

# ============================================================
# AUDIT: Count documents per index
# ============================================================
log "${BOLD}${YELLOW}>> DATA AUDIT BY INDEX${NC}"
log ""

# Traces
TRACE_COUNT=$(es_count "$TRACE_INDEX" "$QUERY_BODY")
log "Traces (${TRACE_INDEX}): ${BOLD}$TRACE_COUNT${NC} documents"

# DSPy Steps
DSPY_COUNT=$(es_count "$DSPY_INDEX" "$QUERY_BODY")
log "DSPy Steps (${DSPY_INDEX}): ${BOLD}$DSPY_COUNT${NC} documents"

# Batch Evaluations
BATCH_EVAL_COUNT=$(es_count "$BATCH_EVAL_INDEX" "$QUERY_BODY")
log "Batch Evaluations (${BATCH_EVAL_INDEX}): ${BOLD}$BATCH_EVAL_COUNT${NC} documents"

# Scenario Events
SCENARIO_COUNT=$(es_count "$SCENARIO_INDEX" "$QUERY_BODY")
log "Scenario Events (${SCENARIO_INDEX}): ${BOLD}$SCENARIO_COUNT${NC} documents"

TOTAL_COUNT=$((TRACE_COUNT + DSPY_COUNT + BATCH_EVAL_COUNT + SCENARIO_COUNT))
log ""
log "${BOLD}Total documents to delete: $TOTAL_COUNT${NC}"
log ""

if [ "$TOTAL_COUNT" -eq 0 ]; then
    log "${GREEN}No documents found for the specified project(s).${NC}"
    log ""
    log "Report saved to: ${CYAN}$REPORT_FILE${NC}"
    exit 0
fi

# ============================================================
# SAMPLE DOCUMENT IDS
# ============================================================
log "${BOLD}${YELLOW}>> SAMPLE DOCUMENT IDS (first 10 per index)${NC}"
log ""

if [ "$TRACE_COUNT" -gt 0 ]; then
    log "${CYAN}Traces:${NC}"
    TRACE_IDS=$(es_get_ids "$TRACE_INDEX" "$QUERY_BODY" 10)
    for id in $TRACE_IDS; do
        log "  DELETE trace_id: $id"
    done
    if [ "$TRACE_COUNT" -gt 10 ]; then
        log "  ... and $((TRACE_COUNT - 10)) more"
    fi
    log ""
fi

if [ "$DSPY_COUNT" -gt 0 ]; then
    log "${CYAN}DSPy Steps:${NC}"
    DSPY_IDS=$(es_get_ids "$DSPY_INDEX" "$QUERY_BODY" 10)
    for id in $DSPY_IDS; do
        log "  DELETE dspy_step_id: $id"
    done
    if [ "$DSPY_COUNT" -gt 10 ]; then
        log "  ... and $((DSPY_COUNT - 10)) more"
    fi
    log ""
fi

if [ "$BATCH_EVAL_COUNT" -gt 0 ]; then
    log "${CYAN}Batch Evaluations:${NC}"
    BATCH_IDS=$(es_get_ids "$BATCH_EVAL_INDEX" "$QUERY_BODY" 10)
    for id in $BATCH_IDS; do
        log "  DELETE batch_eval_id: $id"
    done
    if [ "$BATCH_EVAL_COUNT" -gt 10 ]; then
        log "  ... and $((BATCH_EVAL_COUNT - 10)) more"
    fi
    log ""
fi

if [ "$SCENARIO_COUNT" -gt 0 ]; then
    log "${CYAN}Scenario Events:${NC}"
    SCENARIO_IDS=$(es_get_ids "$SCENARIO_INDEX" "$QUERY_BODY" 10)
    for id in $SCENARIO_IDS; do
        log "  DELETE scenario_event_id: $id"
    done
    if [ "$SCENARIO_COUNT" -gt 10 ]; then
        log "  ... and $((SCENARIO_COUNT - 10)) more"
    fi
    log ""
fi

# ============================================================
# ACTIONS SUMMARY
# ============================================================
log "${BOLD}${YELLOW}>> ACTIONS SUMMARY${NC}"
log ""
for pid in "${PROJECT_ID_ARRAY[@]}"; do
    log "Project: $pid"
done
log ""

[ "$TRACE_COUNT" -gt 0 ] && log "${RED}DELETE $TRACE_COUNT traces from $TRACE_INDEX${NC}"
[ "$DSPY_COUNT" -gt 0 ] && log "${RED}DELETE $DSPY_COUNT DSPy steps from $DSPY_INDEX${NC}"
[ "$BATCH_EVAL_COUNT" -gt 0 ] && log "${RED}DELETE $BATCH_EVAL_COUNT batch evaluations from $BATCH_EVAL_INDEX${NC}"
[ "$SCENARIO_COUNT" -gt 0 ] && log "${RED}DELETE $SCENARIO_COUNT scenario events from $SCENARIO_INDEX${NC}"
log ""

# ============================================================
# EXECUTE OR DRY RUN
# ============================================================
if [ "$EXECUTE_MODE" = true ]; then
    log "${BOLD}${RED}=================================================================${NC}"
    log "${BOLD}${RED}EXECUTING DELETION${NC}"
    log "${BOLD}${RED}=================================================================${NC}"
    log ""

    # Confirmation prompt
    echo -e "${RED}${BOLD}⚠️  WARNING: This will permanently delete ES data!${NC}"
    echo -e "Type 'DELETE' to confirm: "
    read -r CONFIRM

    if [ "$CONFIRM" != "DELETE" ]; then
        log "${RED}❌ Confirmation did not match. Aborting.${NC}"
        exit 1
    fi

    log "${YELLOW}Starting ES deletion...${NC}"
    log ""

    # Delete from each index
    if [ "$TRACE_COUNT" -gt 0 ]; then
        log "Deleting traces..."
        RESULT=$(es_delete_by_query "$TRACE_INDEX" "$QUERY_BODY")
        DELETED=$(echo "$RESULT" | grep -o '"deleted":[0-9]*' | cut -d: -f2 || echo "?")
        log "  ${GREEN}✓ Deleted $DELETED traces${NC}"
    fi

    if [ "$DSPY_COUNT" -gt 0 ]; then
        log "Deleting DSPy steps..."
        RESULT=$(es_delete_by_query "$DSPY_INDEX" "$QUERY_BODY")
        DELETED=$(echo "$RESULT" | grep -o '"deleted":[0-9]*' | cut -d: -f2 || echo "?")
        log "  ${GREEN}✓ Deleted $DELETED DSPy steps${NC}"
    fi

    if [ "$BATCH_EVAL_COUNT" -gt 0 ]; then
        log "Deleting batch evaluations..."
        RESULT=$(es_delete_by_query "$BATCH_EVAL_INDEX" "$QUERY_BODY")
        DELETED=$(echo "$RESULT" | grep -o '"deleted":[0-9]*' | cut -d: -f2 || echo "?")
        log "  ${GREEN}✓ Deleted $DELETED batch evaluations${NC}"
    fi

    if [ "$SCENARIO_COUNT" -gt 0 ]; then
        log "Deleting scenario events..."
        RESULT=$(es_delete_by_query "$SCENARIO_INDEX" "$QUERY_BODY")
        DELETED=$(echo "$RESULT" | grep -o '"deleted":[0-9]*' | cut -d: -f2 || echo "?")
        log "  ${GREEN}✓ Deleted $DELETED scenario events${NC}"
    fi

    log ""
    log "${GREEN}✓ ES deletion completed${NC}"

    # Verify deletion
    log ""
    log "${BOLD}${YELLOW}>> POST-DELETION VERIFICATION${NC}"
    REMAINING=$(es_count "$TRACE_INDEX" "$QUERY_BODY")
    REMAINING=$((REMAINING + $(es_count "$DSPY_INDEX" "$QUERY_BODY")))
    REMAINING=$((REMAINING + $(es_count "$BATCH_EVAL_INDEX" "$QUERY_BODY")))
    REMAINING=$((REMAINING + $(es_count "$SCENARIO_INDEX" "$QUERY_BODY")))
    
    if [ "$REMAINING" = "0" ]; then
        log "${GREEN}✓ All project data successfully deleted from ES${NC}"
    else
        log "${YELLOW}⚠ $REMAINING documents remain (may be due to replication lag)${NC}"
    fi

else
    log "${BOLD}${GREEN}=================================================================${NC}"
    log "${BOLD}${GREEN}DRY RUN COMPLETE - NO CHANGES MADE${NC}"
    log "${BOLD}${GREEN}=================================================================${NC}"
    log ""
    log "To execute deletion, run:"
    log "  ${CYAN}$0 $PROJECT_IDS --execute${NC}"
fi

log ""
log "Report saved to: ${CYAN}$REPORT_FILE${NC}"
log ""

