# Manual Testing Guide for LangWatch APP

## Overview

This document defines the critical **happy paths** for LangWatch that must work reliably. These are the core user workflows that, if broken, would significantly impact user experience. Each section provides focused manual testing steps to verify functionality before releases.

## Core Happy Paths

### 1. 🎯 **Evaluation Creation & Management** (30-45 minutes)

#### Happy Path 1.1: Create Evaluation via Wizard
**User Goal**: Create a new evaluation to monitor LLM performance

**Steps**:
1. Navigate to `/[project]/evaluations/wizard`
2. **Task Selection**: Choose "Real-time monitoring" 
3. **Data Source**: Select "From production traces"
4. **Evaluation Type**: Choose category → Select evaluator (e.g., "Answer Relevance")
5. **Settings**: Configure evaluator parameters
6. **Execution**: Set up real-time monitoring with sampling
7. **Results**: Name evaluation and save as monitor

**Success Criteria**:
- ✅ Wizard completes without errors
- ✅ Monitor appears in monitors list
- ✅ Handle/slug is generated correctly
- ✅ Settings persist correctly

#### Happy Path 1.2: Run Batch Evaluation
**User Goal**: Evaluate existing dataset against LLM outputs

**Steps**:
1. Create/select dataset with required columns
2. Run evaluation wizard with "Batch evaluation" task
3. Map dataset columns to evaluator inputs
4. Execute evaluation on dataset
5. View results and metrics

**Success Criteria**:
- ✅ Evaluation runs successfully
- ✅ Results are displayed correctly
- ✅ Can export/analyze results

### 2. 📊 **Trace Monitoring & Analysis** (20-30 minutes)

#### Happy Path 2.1: View Live Traces
**User Goal**: Monitor incoming LLM traces in real-time

**Steps**:
1. Navigate to traces dashboard
2. Filter by time range, model, or metadata
3. Click on individual trace to view details
4. Examine spans, inputs, outputs, and evaluations
5. Add annotations or feedback

**Success Criteria**:
- ✅ Traces load and display correctly
- ✅ Filtering works as expected
- ✅ Trace details are complete and accurate
- ✅ Annotations save successfully

#### Happy Path 2.2: Create Custom Filters
**User Goal**: Set up monitoring for specific conditions

**Steps**:
1. Access filters/monitoring setup
2. Create filter based on trace properties
3. Set up alerts for filter conditions
4. Test filter with existing traces

**Success Criteria**:
- ✅ Filter saves and applies correctly
- ✅ Alert triggers work as expected

### 3. 🔧 **Prompt Configuration** (15-20 minutes)

#### Happy Path 3.1: Create & Version Prompts
**User Goal**: Manage prompt templates with version control

**Steps**:
1. Navigate to prompt configurations
2. Create new prompt with handle/name
3. Configure model, temperature, messages
4. Save initial version
5. Make changes and create new version
6. Compare versions and rollback if needed

**Success Criteria**:
- ✅ Prompt saves with unique handle
- ✅ Versions are tracked correctly
- ✅ Can switch between versions
- ✅ Handle validation prevents duplicates

#### Happy Path 3.2: Sync Prompts from Code
**User Goal**: Keep prompts synchronized with local development

**Steps**:
1. Use SDK/API to sync prompt from local file
2. Handle version conflicts
3. Verify sync results

**Success Criteria**:
- ✅ Sync completes without errors
- ✅ Conflicts are handled gracefully
- ✅ Version numbers increment correctly

### 4. 🧪 **Optimization Studio** (25-30 minutes)

#### Happy Path 4.1: Create Workflow
**User Goal**: Build evaluation/optimization workflow

**Steps**:
1. Open Optimization Studio
2. Add entry node with dataset
3. Add LLM/evaluator nodes
4. Connect nodes with proper mappings
5. Configure node parameters
6. Run workflow and view results

**Success Criteria**:
- ✅ Workflow saves and loads correctly
- ✅ Node connections work properly
- ✅ Execution produces expected results

### 5. 📈 **Analytics & Reporting** (10-15 minutes)

#### Happy Path 5.1: View Performance Metrics
**User Goal**: Analyze LLM performance over time

**Steps**:
1. Access analytics dashboard
2. Select time range and filters
3. View key metrics (cost, latency, quality scores)
4. Drill down into specific issues
5. Export reports if needed

**Success Criteria**:
- ✅ Metrics load and display correctly
- ✅ Drill-down functionality works
- ✅ Data is accurate and up-to-date

## Critical Edge Cases & Error Scenarios

### Handle Validation (Evaluation Wizard Focus)
**Current Issue**: LWH-1265 - Handle setting in evaluation wizard

**Test Cases**:
1. **Handle Generation**: Create evaluation with special characters in name
2. **Duplicate Prevention**: Try creating evaluation with existing name
3. **Form Auto-Save**: Verify settings persist when navigating wizard steps
4. **Error Recovery**: Test network interruption during wizard

**Success Criteria**:
- ✅ Handle validation follows npm package naming pattern
- ✅ Duplicate handles are prevented with clear error messages
- ✅ Form auto-save works without console errors
- ✅ Graceful error handling for network issues

### Authentication & Permissions
**Test Cases**:
1. Login/logout flow
2. Project access permissions
3. Team member role restrictions

### Data Integrity
**Test Cases**:
1. Large dataset handling
2. Concurrent user operations
3. Data export/import accuracy

## Browser Compatibility

### Primary Support
- **Chrome** (latest): Full testing required
- **Safari** (latest): Spot check critical paths

### Mobile Responsiveness
- Basic functionality check on mobile/tablet viewports

## Environment Setup

### Prerequisites
- Test project with sample data
- API keys configured for evaluators
- Multiple user roles available for testing

### Data Cleanup Protocol
After each testing session:
1. Delete test evaluations/monitors created
2. Remove test prompt configurations
3. Clear test annotations/feedback
4. Reset any modified project settings

## Testing Checklist Template
