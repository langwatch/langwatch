#!/bin/bash
# User Deletion Script for GDPR/Compliance
# Usage:
#   Dry run (default):  ./scripts/user-delete.sh <email>
#   Execute deletion:   ./scripts/user-delete.sh <email> --execute
#
# Via make:
#   make user-delete-dry-run EMAIL=user@example.com
#   make user-delete EMAIL=user@example.com

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
TARGET_EMAIL=""
EXECUTE_MODE=false

for arg in "$@"; do
    case $arg in
        --execute)
            EXECUTE_MODE=true
            ;;
        *)
            if [ -z "$TARGET_EMAIL" ]; then
                TARGET_EMAIL="$arg"
            fi
            ;;
    esac
done

if [ -z "$TARGET_EMAIL" ]; then
    echo -e "${RED}Error: Email address required${NC}"
    echo "Usage: $0 <email> [--execute]"
    echo ""
    echo "Options:"
    echo "  --execute    Actually perform the deletion (default is dry-run)"
    echo ""
    echo "Examples:"
    echo "  $0 user@example.com              # Dry run - shows what would be deleted"
    echo "  $0 user@example.com --execute    # Actually delete the user"
    exit 1
fi

if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL environment variable is not set${NC}"
    exit 1
fi

# Check for ES environment (optional - will skip ES deletion if not set)
ES_AVAILABLE=false
if [ -n "$ELASTICSEARCH_NODE_URL" ]; then
    ES_AVAILABLE=true
fi

# Extract schema from DATABASE_URL if present (Prisma-specific parameter)
# and convert to psql-compatible format
SCHEMA=""
if [[ "$DATABASE_URL" =~ schema=([^&]+) ]]; then
    SCHEMA="${BASH_REMATCH[1]}"
fi

# Remove schema parameter from URL (psql doesn't understand it)
PSQL_URL=$(echo "$DATABASE_URL" | sed 's/[&?]schema=[^&]*//')

# Create reports directory
REPORTS_DIR="$(dirname "$0")/../reports"
mkdir -p "$REPORTS_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="${REPORTS_DIR}/user_deletion_${TIMESTAMP}_$(echo "$TARGET_EMAIL" | tr '@.' '_').txt"

# Logging function
log() {
    echo -e "$1"
    echo -e "$1" | sed 's/\x1b\[[0-9;]*m//g' >> "$REPORT_FILE"
}

# SQL execution functions
run_sql() {
    if [ -n "$SCHEMA" ]; then
        psql "$PSQL_URL" -t -A -c "SET search_path TO $SCHEMA, public; $1" 2>/dev/null
    else
        psql "$PSQL_URL" -t -A -c "$1" 2>/dev/null
    fi
}

run_sql_table() {
    if [ -n "$SCHEMA" ]; then
        psql "$PSQL_URL" -c "SET search_path TO $SCHEMA, public; $1" 2>/dev/null
    else
        psql "$PSQL_URL" -c "$1" 2>/dev/null
    fi
}

# Start report
log "${BOLD}${BLUE}USER DELETION REPORT${NC}"
log "Email: ${CYAN}${TARGET_EMAIL}${NC} | Timestamp: $(date)"
log "Mode: $([ "$EXECUTE_MODE" = true ] && echo -e "${RED}EXECUTE${NC}" || echo -e "${GREEN}DRY RUN${NC}")"
log ""

# Get user ID
USER_ID=$(run_sql "SELECT id FROM \"User\" WHERE email = '${TARGET_EMAIL}' LIMIT 1")

if [ -z "$USER_ID" ]; then
    log "${RED}❌ No user found with email: ${TARGET_EMAIL}${NC}"
    exit 1
fi

log "User ID: ${CYAN}${USER_ID}${NC}"
log ""

# ============================================================
# ENTITY COUNTS (for audit confidence)
# ============================================================
log "${BOLD}ENTITY COUNTS:${NC}"

COUNT_Account=$(run_sql "SELECT COUNT(*) FROM \"Account\" WHERE \"userId\" = '${USER_ID}'")
COUNT_Session=$(run_sql "SELECT COUNT(*) FROM \"Session\" WHERE \"userId\" = '${USER_ID}'")
COUNT_TeamUser=$(run_sql "SELECT COUNT(*) FROM \"TeamUser\" WHERE \"userId\" = '${USER_ID}'")
COUNT_OrganizationUser=$(run_sql "SELECT COUNT(*) FROM \"OrganizationUser\" WHERE \"userId\" = '${USER_ID}'")
COUNT_Annotation=$(run_sql "SELECT COUNT(*) FROM \"Annotation\" WHERE \"userId\" = '${USER_ID}'")
COUNT_PublicShare=$(run_sql "SELECT COUNT(*) FROM \"PublicShare\" WHERE \"userId\" = '${USER_ID}'")
COUNT_Workflow=$(run_sql "SELECT COUNT(*) FROM \"Workflow\" WHERE \"publishedById\" = '${USER_ID}'")
COUNT_WorkflowVersion=$(run_sql "SELECT COUNT(*) FROM \"WorkflowVersion\" WHERE \"authorId\" = '${USER_ID}'")
COUNT_AnnotationQueueMembers=$(run_sql "SELECT COUNT(*) FROM \"AnnotationQueueMembers\" WHERE \"userId\" = '${USER_ID}'")
COUNT_AnnotationQueueItemAssigned=$(run_sql "SELECT COUNT(*) FROM \"AnnotationQueueItem\" WHERE \"userId\" = '${USER_ID}'")
COUNT_AnnotationQueueItemCreated=$(run_sql "SELECT COUNT(*) FROM \"AnnotationQueueItem\" WHERE \"createdByUserId\" = '${USER_ID}'")
COUNT_LlmPromptConfigVersion=$(run_sql "SELECT COUNT(*) FROM \"LlmPromptConfigVersion\" WHERE \"authorId\" = '${USER_ID}'")
COUNT_AuditLog=$(run_sql "SELECT COUNT(*) FROM \"AuditLog\" WHERE \"userId\" = '${USER_ID}'")

# Sole-owned counts
COUNT_SoleOrgs=$(run_sql "SELECT COUNT(*) FROM \"Organization\" o JOIN \"OrganizationUser\" ou ON o.id = ou.\"organizationId\" WHERE ou.\"userId\" = '${USER_ID}' GROUP BY o.id HAVING COUNT(*) = 1;" | wc -l | tr -d ' ')
COUNT_SoleTeams=$(run_sql "SELECT COUNT(*) FROM \"Team\" t JOIN \"TeamUser\" tu ON t.id = tu.\"teamId\" WHERE tu.\"userId\" = '${USER_ID}' GROUP BY t.id HAVING COUNT(*) = 1;" | wc -l | tr -d ' ')
COUNT_SoleProjects=$(run_sql "SELECT COUNT(*) FROM \"Project\" p WHERE p.\"teamId\" IN (SELECT t.id FROM \"Team\" t JOIN \"TeamUser\" tu ON t.id = tu.\"teamId\" WHERE tu.\"userId\" = '${USER_ID}' GROUP BY t.id HAVING COUNT(*) = 1);")

log "  Organization: $COUNT_OrganizationUser (sole owner: $COUNT_SoleOrgs)"
log "  Team: $COUNT_TeamUser (sole owner: $COUNT_SoleTeams)"
log "  Project: $COUNT_SoleProjects (under sole-owned teams)"
log "  Account: $COUNT_Account"
log "  Session: $COUNT_Session"
log "  Annotation: $COUNT_Annotation"
log "  PublicShare: $COUNT_PublicShare"
log "  Workflow: $COUNT_Workflow"
log "  WorkflowVersion: $COUNT_WorkflowVersion"
log "  LlmPromptConfigVersion: $COUNT_LlmPromptConfigVersion"
log "  AnnotationQueueMembers: $COUNT_AnnotationQueueMembers"
log "  AnnotationQueueItem: $((COUNT_AnnotationQueueItemAssigned + COUNT_AnnotationQueueItemCreated))"
log "  AuditLog: $COUNT_AuditLog"
log ""

# ============================================================
# CHECK FOR BLOCKING CONDITIONS
# ============================================================

# Check if user is sole admin of teams with other members
SOLE_ADMIN_TEAMS=$(run_sql "
SELECT t.name || ' (' || t.id || ')'
FROM \"Team\" t
JOIN \"TeamUser\" tu ON t.id = tu.\"teamId\"
WHERE tu.\"userId\" = '${USER_ID}'
AND tu.role = 'ADMIN'
AND NOT EXISTS (
    SELECT 1 FROM \"TeamUser\" tu2
    WHERE tu2.\"teamId\" = t.id
    AND tu2.\"userId\" != '${USER_ID}'
    AND tu2.role = 'ADMIN'
)
AND EXISTS (
    SELECT 1 FROM \"TeamUser\" tu3
    WHERE tu3.\"teamId\" = t.id
    AND tu3.\"userId\" != '${USER_ID}'
);
")

# Check if user is sole admin of orgs with other members
SOLE_ADMIN_ORGS=$(run_sql "
SELECT o.name || ' (' || o.id || ')'
FROM \"Organization\" o
JOIN \"OrganizationUser\" ou ON o.id = ou.\"organizationId\"
WHERE ou.\"userId\" = '${USER_ID}'
AND ou.role = 'ADMIN'
AND NOT EXISTS (
    SELECT 1 FROM \"OrganizationUser\" ou2
    WHERE ou2.\"organizationId\" = o.id
    AND ou2.\"userId\" != '${USER_ID}'
    AND ou2.role = 'ADMIN'
)
AND EXISTS (
    SELECT 1 FROM \"OrganizationUser\" ou3
    WHERE ou3.\"organizationId\" = o.id
    AND ou3.\"userId\" != '${USER_ID}'
);
")

# Check for teams with other members under sole-owned orgs
ORPHAN_TEAMS=$(run_sql "
SELECT t.name || ' (' || t.id || ')'
FROM \"Team\" t
JOIN \"Organization\" o ON t.\"organizationId\" = o.id
JOIN \"OrganizationUser\" ou ON o.id = ou.\"organizationId\"
WHERE ou.\"userId\" = '${USER_ID}'
AND (SELECT COUNT(*) FROM \"OrganizationUser\" WHERE \"organizationId\" = o.id) = 1
AND (SELECT COUNT(*) FROM \"TeamUser\" WHERE \"teamId\" = t.id AND \"userId\" != '${USER_ID}') > 0;
")

HAS_BLOCKERS=false

if [ -n "$SOLE_ADMIN_TEAMS" ]; then
    log "${RED}⚠️  BLOCKER: Sole admin of teams with other members - promote another admin first:${NC}"
    echo "$SOLE_ADMIN_TEAMS" | while read -r line; do [ -n "$line" ] && log "   $line"; done
    HAS_BLOCKERS=true
fi

if [ -n "$SOLE_ADMIN_ORGS" ]; then
    log "${RED}⚠️  BLOCKER: Sole admin of orgs with other members - promote another admin first:${NC}"
    echo "$SOLE_ADMIN_ORGS" | while read -r line; do [ -n "$line" ] && log "   $line"; done
    HAS_BLOCKERS=true
fi

if [ -n "$ORPHAN_TEAMS" ]; then
    log "${RED}⚠️  BLOCKER: Teams with other members under sole-owned orgs:${NC}"
    echo "$ORPHAN_TEAMS" | while read -r line; do [ -n "$line" ] && log "   $line"; done
    HAS_BLOCKERS=true
fi

if [ "$HAS_BLOCKERS" = true ]; then
    log ""
    log "${RED}❌ Cannot proceed - fix blockers above and re-run${NC}"
    log "Report: $REPORT_FILE"
    exit 1
fi

# ============================================================
# ACTIONS LIST
# ============================================================
log "${BOLD}ACTIONS:${NC}"
log ""

# DELETE: User
log "${RED}DELETE${NC} User ${USER_ID} (${TARGET_EMAIL})"

# DELETE: Sole-owned organizations
run_sql "
SELECT 'DELETE Organization ' || o.id || ' (' || o.name || ')'
FROM \"Organization\" o
JOIN \"OrganizationUser\" ou ON o.id = ou.\"organizationId\"
WHERE ou.\"userId\" = '${USER_ID}'
GROUP BY o.id, o.name
HAVING COUNT(*) = 1;
" | while read -r line; do [ -n "$line" ] && log "${RED}$line${NC}"; done

# DELETE: Sole-owned teams
run_sql "
SELECT 'DELETE Team ' || t.id || ' (' || t.name || ')'
FROM \"Team\" t
JOIN \"TeamUser\" tu ON t.id = tu.\"teamId\"
WHERE tu.\"userId\" = '${USER_ID}'
GROUP BY t.id, t.name
HAVING COUNT(*) = 1;
" | while read -r line; do [ -n "$line" ] && log "${RED}$line${NC}"; done

# DELETE: Projects under sole-owned teams
run_sql "
SELECT 'DELETE Project ' || p.id || ' (' || p.name || ')'
FROM \"Project\" p
WHERE p.\"teamId\" IN (
    SELECT t.id FROM \"Team\" t
    JOIN \"TeamUser\" tu ON t.id = tu.\"teamId\"
    WHERE tu.\"userId\" = '${USER_ID}'
    GROUP BY t.id HAVING COUNT(*) = 1
);
" | while read -r line; do [ -n "$line" ] && log "${RED}$line${NC}"; done

# REMOVE: Shared org memberships
run_sql "
SELECT 'REMOVE OrganizationUser ' || o.id || ' (' || o.name || ', ' || (SELECT COUNT(*) - 1 FROM \"OrganizationUser\" WHERE \"organizationId\" = o.id) || ' members remain)'
FROM \"Organization\" o
JOIN \"OrganizationUser\" ou ON o.id = ou.\"organizationId\"
WHERE ou.\"userId\" = '${USER_ID}'
AND (SELECT COUNT(*) FROM \"OrganizationUser\" WHERE \"organizationId\" = o.id) > 1;
" | while read -r line; do [ -n "$line" ] && log "${YELLOW}$line${NC}"; done

# REMOVE: Shared team memberships
run_sql "
SELECT 'REMOVE TeamUser ' || t.id || ' (' || t.name || ', ' || (SELECT COUNT(*) - 1 FROM \"TeamUser\" WHERE \"teamId\" = t.id) || ' members remain)'
FROM \"Team\" t
JOIN \"TeamUser\" tu ON t.id = tu.\"teamId\"
WHERE tu.\"userId\" = '${USER_ID}'
AND (SELECT COUNT(*) FROM \"TeamUser\" WHERE \"teamId\" = t.id) > 1;
" | while read -r line; do [ -n "$line" ] && log "${YELLOW}$line${NC}"; done

# NULLIFY: Annotations
run_sql "SELECT 'NULLIFY Annotation.userId ' || id FROM \"Annotation\" WHERE \"userId\" = '${USER_ID}';" | while read -r line; do [ -n "$line" ] && log "${CYAN}$line${NC}"; done

# NULLIFY: Public shares
run_sql "SELECT 'NULLIFY PublicShare.userId ' || id FROM \"PublicShare\" WHERE \"userId\" = '${USER_ID}';" | while read -r line; do [ -n "$line" ] && log "${CYAN}$line${NC}"; done

# NULLIFY: Workflows
run_sql "SELECT 'NULLIFY Workflow.publishedById ' || id FROM \"Workflow\" WHERE \"publishedById\" = '${USER_ID}';" | while read -r line; do [ -n "$line" ] && log "${CYAN}$line${NC}"; done

# NULLIFY: Workflow versions
run_sql "SELECT 'NULLIFY WorkflowVersion.authorId ' || id FROM \"WorkflowVersion\" WHERE \"authorId\" = '${USER_ID}';" | while read -r line; do [ -n "$line" ] && log "${CYAN}$line${NC}"; done

# NULLIFY: Prompt config versions
run_sql "SELECT 'NULLIFY LlmPromptConfigVersion.authorId ' || id FROM \"LlmPromptConfigVersion\" WHERE \"authorId\" = '${USER_ID}';" | while read -r line; do [ -n "$line" ] && log "${CYAN}$line${NC}"; done

# NULLIFY: Queue items assigned
run_sql "SELECT 'NULLIFY AnnotationQueueItem.userId ' || id FROM \"AnnotationQueueItem\" WHERE \"userId\" = '${USER_ID}';" | while read -r line; do [ -n "$line" ] && log "${CYAN}$line${NC}"; done

# NULLIFY: Queue items created
run_sql "SELECT 'NULLIFY AnnotationQueueItem.createdByUserId ' || id FROM \"AnnotationQueueItem\" WHERE \"createdByUserId\" = '${USER_ID}';" | while read -r line; do [ -n "$line" ] && log "${CYAN}$line${NC}"; done

# ANONYMIZE: Audit logs (keep trail, strip PII)
run_sql "SELECT 'ANONYMIZE AuditLog ' || id FROM \"AuditLog\" WHERE \"userId\" = '${USER_ID}';" | while read -r line; do [ -n "$line" ] && log "${CYAN}$line${NC}"; done

log ""

# ============================================================
# ELASTICSEARCH DATA AUDIT
# ============================================================
log "${BOLD}${YELLOW}>> ELASTICSEARCH DATA (to be deleted)${NC}"
log ""

# Get project IDs for sole-owned projects
ES_PROJECT_IDS=$(run_sql "
    SELECT string_agg(p.id, ',')
    FROM \"Project\" p
    WHERE p.\"teamId\" IN (
        SELECT t.id FROM \"Team\" t
        JOIN \"TeamUser\" tu ON t.id = tu.\"teamId\"
        WHERE tu.\"userId\" = '${USER_ID}'
        GROUP BY t.id HAVING COUNT(*) = 1
    );
")

if [ -z "$ES_PROJECT_IDS" ]; then
    log "No sole-owned projects - no ES data to delete"
elif [ "$ES_AVAILABLE" = false ]; then
    log "${YELLOW}⚠ ELASTICSEARCH_NODE_URL not set - cannot audit ES data${NC}"
    log "  Projects that would be deleted: $ES_PROJECT_IDS"
    log "  Set ELASTICSEARCH_NODE_URL to see ES document counts"
else
    SCRIPT_DIR="$(dirname "$0")"
    if [ -x "$SCRIPT_DIR/es-project-delete.sh" ]; then
        # Run ES script in dry-run mode (no --execute)
        "$SCRIPT_DIR/es-project-delete.sh" "$ES_PROJECT_IDS" 2>&1 | grep -v "Report saved" | tee -a "$REPORT_FILE"
    else
        log "${YELLOW}⚠ ES deletion script not found${NC}"
        log "  Projects: $ES_PROJECT_IDS"
    fi
fi

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
    echo -e "${RED}${BOLD}⚠️  WARNING: This will permanently delete user data!${NC}"
    echo -e "Type the email address to confirm: "
    read -r CONFIRM_EMAIL

    if [ "$CONFIRM_EMAIL" != "$TARGET_EMAIL" ]; then
        log "${RED}❌ Email confirmation did not match. Aborting.${NC}"
        exit 1
    fi

    # Collect project IDs BEFORE deletion (for ES cleanup)
    PROJECT_IDS_TO_DELETE=$(run_sql "
        SELECT string_agg(p.id, ',')
        FROM \"Project\" p
        WHERE p.\"teamId\" IN (
            SELECT t.id FROM \"Team\" t
            JOIN \"TeamUser\" tu ON t.id = tu.\"teamId\"
            WHERE tu.\"userId\" = '${USER_ID}'
            GROUP BY t.id HAVING COUNT(*) = 1
        );
    ")

    log "${YELLOW}Starting deletion transaction...${NC}"

    # Build the deletion SQL
    DELETION_SQL="
BEGIN;

-- ============================================================
-- PHASE 1: Nullify user references on SHARED entities
-- ============================================================

-- Nullify user references (these entities may be shared)
UPDATE \"Annotation\" SET \"userId\" = NULL WHERE \"userId\" = '${USER_ID}';
UPDATE \"PublicShare\" SET \"userId\" = NULL WHERE \"userId\" = '${USER_ID}';
UPDATE \"Workflow\" SET \"publishedById\" = NULL WHERE \"publishedById\" = '${USER_ID}';
UPDATE \"WorkflowVersion\" SET \"authorId\" = NULL WHERE \"authorId\" = '${USER_ID}';
UPDATE \"AnnotationQueueItem\" SET \"userId\" = NULL WHERE \"userId\" = '${USER_ID}';
UPDATE \"AnnotationQueueItem\" SET \"createdByUserId\" = NULL WHERE \"createdByUserId\" = '${USER_ID}';
UPDATE \"LlmPromptConfigVersion\" SET \"authorId\" = NULL WHERE \"authorId\" = '${USER_ID}';

-- Anonymize audit logs (keep trail, strip PII)
UPDATE \"AuditLog\" SET \"userId\" = '[deleted]', \"ipAddress\" = '[deleted]', \"userAgent\" = '[deleted]' WHERE \"userId\" = '${USER_ID}';

-- Remove from shared annotation queues
DELETE FROM \"AnnotationQueueMembers\" WHERE \"userId\" = '${USER_ID}';

-- ============================================================
-- PHASE 2: Delete SOLE-OWNED Projects and their children
-- ============================================================

-- Get project IDs to delete (under sole-owned teams)
CREATE TEMP TABLE projects_to_delete AS
SELECT p.id FROM \"Project\" p
WHERE p.\"teamId\" IN (
    SELECT t.id FROM \"Team\" t
    JOIN \"TeamUser\" tu ON t.id = tu.\"teamId\"
    WHERE tu.\"userId\" = '${USER_ID}'
    GROUP BY t.id HAVING COUNT(*) = 1
);

-- Delete project children (order matters for some FKs)
DELETE FROM \"LlmPromptConfigVersion\" WHERE \"configId\" IN (SELECT id FROM \"LlmPromptConfig\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete));
DELETE FROM \"LlmPromptConfig\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);

-- Workflow: clear self-references first, then delete versions, then workflows
UPDATE \"Workflow\" SET \"latestVersionId\" = NULL, \"currentVersionId\" = NULL WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);
DELETE FROM \"WorkflowVersion\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);
DELETE FROM \"Workflow\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);

-- BatchEvaluation references Experiment and Dataset
DELETE FROM \"BatchEvaluation\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);

-- Monitor references Experiment
DELETE FROM \"Monitor\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);

-- Experiment references Workflow (already deleted)
DELETE FROM \"Experiment\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);

-- AnnotationQueue children
DELETE FROM \"AnnotationQueueItem\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);
DELETE FROM \"AnnotationQueueScores\" WHERE \"annotationQueueId\" IN (SELECT id FROM \"AnnotationQueue\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete));
DELETE FROM \"AnnotationQueueMembers\" WHERE \"annotationQueueId\" IN (SELECT id FROM \"AnnotationQueue\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete));
DELETE FROM \"AnnotationQueue\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);

-- Dataset children
DELETE FROM \"DatasetRecord\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);
DELETE FROM \"Dataset\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);

-- Dashboard and CustomGraph
DELETE FROM \"CustomGraph\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);
DELETE FROM \"Dashboard\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);

-- Trigger children
DELETE FROM \"TriggerSent\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);
DELETE FROM \"Trigger\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);

-- Topic has self-reference (subtopics)
UPDATE \"Topic\" SET \"parentId\" = NULL WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);
DELETE FROM \"Topic\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);

-- Simple project children
DELETE FROM \"AnnotationScore\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);
DELETE FROM \"Annotation\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);
DELETE FROM \"PublicShare\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);
DELETE FROM \"ModelProvider\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);
DELETE FROM \"Cost\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);
DELETE FROM \"Analytics\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);
DELETE FROM \"Notification\" WHERE \"projectId\" IN (SELECT id FROM projects_to_delete);

-- Delete projects
DELETE FROM \"Project\" WHERE id IN (SELECT id FROM projects_to_delete);

DROP TABLE projects_to_delete;

-- ============================================================
-- PHASE 3: Delete SOLE-OWNED Teams
-- ============================================================

CREATE TEMP TABLE teams_to_delete AS
SELECT t.id FROM \"Team\" t
JOIN \"TeamUser\" tu ON t.id = tu.\"teamId\"
WHERE tu.\"userId\" = '${USER_ID}'
GROUP BY t.id HAVING COUNT(*) = 1;

DELETE FROM \"TeamUser\" WHERE \"teamId\" IN (SELECT id FROM teams_to_delete);
DELETE FROM \"Team\" WHERE id IN (SELECT id FROM teams_to_delete);

DROP TABLE teams_to_delete;

-- ============================================================
-- PHASE 4: Delete SOLE-OWNED Organizations and their children
-- ============================================================

CREATE TEMP TABLE orgs_to_delete AS
SELECT o.id FROM \"Organization\" o
JOIN \"OrganizationUser\" ou ON o.id = ou.\"organizationId\"
WHERE ou.\"userId\" = '${USER_ID}'
GROUP BY o.id HAVING COUNT(*) = 1;

-- Org children
DELETE FROM \"OrganizationInvite\" WHERE \"organizationId\" IN (SELECT id FROM orgs_to_delete);
DELETE FROM \"OrganizationFeature\" WHERE \"organizationId\" IN (SELECT id FROM orgs_to_delete);
DELETE FROM \"Notification\" WHERE \"organizationId\" IN (SELECT id FROM orgs_to_delete);

-- CustomRole is referenced by TeamUser.assignedRoleId - but teams are already deleted
DELETE FROM \"CustomRole\" WHERE \"organizationId\" IN (SELECT id FROM orgs_to_delete);

DELETE FROM \"OrganizationUser\" WHERE \"organizationId\" IN (SELECT id FROM orgs_to_delete);
DELETE FROM \"Organization\" WHERE id IN (SELECT id FROM orgs_to_delete);

DROP TABLE orgs_to_delete;

-- ============================================================
-- PHASE 5: Remove user from SHARED teams/orgs
-- ============================================================

DELETE FROM \"TeamUser\" WHERE \"userId\" = '${USER_ID}';
DELETE FROM \"OrganizationUser\" WHERE \"userId\" = '${USER_ID}';

-- ============================================================
-- PHASE 6: Delete the User (Account, Session cascade)
-- ============================================================

DELETE FROM \"User\" WHERE id = '${USER_ID}';

COMMIT;
"

    # Prepend search_path if schema is set
    if [ -n "$SCHEMA" ]; then
        DELETION_SQL="SET search_path TO $SCHEMA, public;
$DELETION_SQL"
    fi

    if psql "$PSQL_URL" -c "$DELETION_SQL" 2>&1 | tee -a "$REPORT_FILE"; then
        log ""
        log "${GREEN}✓ Deletion completed successfully${NC}"
    else
        log ""
        log "${RED}❌ Deletion failed - transaction rolled back${NC}"
        exit 1
    fi

    # Verify Postgres deletion
    log ""
    log "${BOLD}${YELLOW}>> POST-DELETION VERIFICATION (Postgres)${NC}"
    REMAINING=$(run_sql "SELECT COUNT(*) FROM \"User\" WHERE id = '${USER_ID}'")
    if [ "$REMAINING" = "0" ]; then
        log "${GREEN}✓ User successfully deleted from Postgres${NC}"
    else
        log "${RED}❌ User still exists - deletion may have failed${NC}"
        exit 1
    fi

    # ============================================================
    # ELASTICSEARCH DELETION
    # ============================================================
    if [ "$ES_AVAILABLE" = true ] && [ -n "$PROJECT_IDS_TO_DELETE" ]; then
        log ""
        log "${BOLD}${YELLOW}>> ELASTICSEARCH DELETION${NC}"
        log "Deleting ES data for projects: $PROJECT_IDS_TO_DELETE"
        log ""

        SCRIPT_DIR="$(dirname "$0")"
        if [ -x "$SCRIPT_DIR/es-project-delete.sh" ]; then
            # Run ES deletion with --execute flag (no confirmation since user already confirmed)
            echo "DELETE" | "$SCRIPT_DIR/es-project-delete.sh" "$PROJECT_IDS_TO_DELETE" --execute 2>&1 | tee -a "$REPORT_FILE"
        else
            log "${YELLOW}⚠ ES deletion script not found or not executable${NC}"
            log "  Run manually: ./scripts/es-project-delete.sh $PROJECT_IDS_TO_DELETE --execute"
        fi
    elif [ "$ES_AVAILABLE" = false ]; then
        log ""
        log "${YELLOW}⚠ ELASTICSEARCH_NODE_URL not set - skipping ES deletion${NC}"
        if [ -n "$PROJECT_IDS_TO_DELETE" ]; then
            log "  Run manually: ELASTICSEARCH_NODE_URL=<url> ./scripts/es-project-delete.sh $PROJECT_IDS_TO_DELETE --execute"
        fi
    fi

else
    log "${BOLD}${GREEN}=================================================================${NC}"
    log "${BOLD}${GREEN}DRY RUN COMPLETE - NO CHANGES MADE${NC}"
    log "${BOLD}${GREEN}=================================================================${NC}"
    log ""
    log "To execute deletion, run:"
    log "  ${CYAN}$0 $TARGET_EMAIL --execute${NC}"
    log ""
    log "Or via make:"
    log "  ${CYAN}make user-delete EMAIL=$TARGET_EMAIL${NC}"
fi

log ""
log "Report saved to: ${CYAN}$REPORT_FILE${NC}"
log ""
