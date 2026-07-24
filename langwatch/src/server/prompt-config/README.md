# Prompt Configuration System

This module provides a comprehensive system for managing LLM prompt configurations with versioning, multi-tenancy, and conflict resolution capabilities.

## Ideal Architecture & Validation Flow

This diagram shows the **ideal layered architecture** with clear separation of concerns and where different types of validation should occur:

```mermaid
graph TB
    %% Entry Points
    TRPC[tRPC Router<br/>API Layer]
    API[REST API<br/>API Layer]

    %% Business Logic Layer
    PS[PromptService<br/>Business Logic Layer<br/><br/>✅ Business Rules Validation<br/>• Handle uniqueness<br/>• Permission checks<br/>• Conflict resolution logic<br/>• Multi-tenancy rules]

    %% Data Access Layer
    LCR[LlmConfigRepository<br/>Data Access Layer<br/><br/>✅ Data Integrity Validation<br/>• Handle formatting<br/>• Relationship constraints<br/>• Data consistency]

    LCVR[LlmConfigVersionsRepository<br/>Version Management<br/><br/>✅ Schema Validation<br/>• configData structure<br/>• Version compatibility<br/>• Schema evolution]

    %% Schema & Validation
    LCVS[LlmConfigVersionSchema<br/>Schema Definitions<br/><br/>✅ Type Validation<br/>• Zod schema validation<br/>• JSON structure<br/>• Field constraints]

    %% Database Layer
    PRISMA[Prisma ORM<br/>Database Abstraction<br/><br/>✅ Database Constraints<br/>• Foreign keys<br/>• Unique constraints<br/>• Type safety]

    DB[(PostgreSQL Database<br/><br/>✅ Final Data Integrity<br/>• ACID transactions<br/>• Referential integrity<br/>• Storage constraints)]

    %% Flow
    TRPC --> PS
    API --> PS
    PS --> LCR
    LCR --> LCVR
    LCVR --> LCVS
    LCVR --> PRISMA
    LCR --> PRISMA
    PRISMA --> DB

    %% Styling
    classDef api fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef service fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef repository fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef schema fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef database fill:#fafafa,stroke:#616161,stroke-width:2px

    class TRPC,API api
    class PS service
    class LCR,LCVR repository
    class LCVS,PRISMA schema
    class DB database
```

## Validation Layers Explained

### 1. **API Layers**

#### **REST API** (Public-Facing)

- **Input Validation**: Strict request structure validation, API key authentication
- **Rate Limiting**: Public API quotas and throttling
- **Security**: Input sanitization, CORS, request size limits
- **Documentation**: OpenAPI/Swagger compliance
- **Backward Compatibility**: Versioned endpoints, stable contracts
- **Should NOT contain**: Business logic, internal implementation details

#### **tRPC Router** (Internal)

- **Input Validation**: Basic type checking (leverages TypeScript)
- **Session Authentication**: Internal user session validation
- **Lightweight**: Minimal overhead for internal operations
- **Type Safety**: End-to-end TypeScript type safety
- **Should NOT contain**: Business logic, but can have more flexible validation

### 2. **Business Logic Layer** (PromptService)

- **Business Rules**: Handle uniqueness, scope validation
- **Permission Logic**: Multi-tenant access control
- **Workflow Validation**: Conflict resolution rules
- **Cross-entity Logic**: Complex business constraints

### 3. **Data Access Layer** (Repositories)

- **Data Integrity**: Handle formatting, relationship validation
- **Transaction Management**: Ensuring atomic operations
- **Query Optimization**: Efficient data retrieval

### 4. **Schema Validation Layer** (LlmConfigVersionSchema)

- **Structure Validation**: JSON schema compliance
- **Type Safety**: Zod-based validation
- **Version Compatibility**: Schema evolution support

### 5. **Database Layer** (Prisma + PostgreSQL)

- **Final Constraints**: Foreign keys, unique constraints
- **ACID Properties**: Transaction isolation
- **Data Persistence**: Storage integrity

## Current State vs Ideal Architecture

### ❌ **Current Issues Found**

1. **tRPC Router Bypasses Service Layer**

   ```typescript
   // ❌ WRONG: Direct repository usage in tRPC
   const repository = new LlmConfigRepository(ctx.prisma);
   return await repository.getAllWithLatestVersion({...});
   ```

2. **Inconsistent API Patterns**

   - REST API ✅ Uses PromptService correctly
   - tRPC Router ❌ Bypasses PromptService, uses repositories directly

3. **Business Logic in Wrong Layer**

   - Permission checks mixed with data access
   - Organization ID resolution in router layer

4. **Type Inconsistencies**
   ```typescript
   // ❌ WRONG: Type mismatch in PromptService
   messages?: CreateLlmConfigVersionParams  // Should be Message[]
   ```

### ✅ **What This Architecture Should Provide**

#### **Separation of Concerns**

- Each layer has a single, well-defined responsibility
- Changes in one layer don't cascade to others
- Easy to test individual components

#### **Validation at the Right Level**

- Business rules in the service layer
- Data structure validation in schema layer
- Database constraints as final safety net

#### **Reusability**

- PromptService can be used by both tRPC and REST APIs
- Repositories can be used across different services
- Schema validation is centralized and consistent

#### **Maintainability**

- Clear boundaries make debugging easier
- New features follow established patterns
- Refactoring is safer with clear interfaces

## Required Fixes

### 1. **Fix tRPC Router** - Make it use PromptService

```typescript
// ✅ CORRECT: Use PromptService in tRPC
const promptService = new PromptService(ctx.prisma);
return await promptService.getAllPrompts({
  projectId: input.projectId,
  organizationId: await promptService.getOrganizationId(input.projectId),
});
```

### 2. **Fix PromptService Types**

```typescript
// ✅ CORRECT: Fix message type
messages?: z.infer<typeof messageSchema>[]  // Not CreateLlmConfigVersionParams
```

### 3. **Move Business Logic to Service**

- Organization ID resolution should be in PromptService
- Permission logic should be centralized
- Both APIs should use identical business logic

## Database Schema

```mermaid
erDiagram
    LlmPromptConfig {
        string id PK
        string name
        string handle UK "Formatted: projectId/handle or orgId/handle"
        string projectId FK
        string organizationId FK
        enum scope "PROJECT | ORGANIZATION"
        string authorId FK
        datetime createdAt
        datetime updatedAt
        datetime deletedAt
    }

    LlmPromptConfigVersion {
        string id PK
        int version "Auto-incremented per config"
        string commitMessage
        string authorId FK
        string configId FK
        json configData "Prompt configuration data"
        string schemaVersion "Schema version (e.g., '1.0')"
        string projectId FK
        datetime createdAt
    }

    User {
        string id PK
        string name
    }

    LlmPromptConfig ||--o{ LlmPromptConfigVersion : "has versions"
    User ||--o{ LlmPromptConfig : "authors"
    User ||--o{ LlmPromptConfigVersion : "authors"
```

## Handle Resolution System

The system uses a sophisticated handle resolution mechanism to support multi-tenancy:

```mermaid
flowchart TD
    A[User Input: 'my-prompt'] --> B{Scope?}

    B -->|PROJECT| C[Format: projectId/my-prompt]
    B -->|ORGANIZATION| D[Format: orgId/my-prompt]

    C --> E[Store in Database]
    D --> E

    E --> F[Retrieval by ID or Handle]

    F --> G{Input Type?}
    G -->|ID| H[Direct ID Lookup]
    G -->|Handle| I{Contains Prefix?}

    I -->|Yes| J[Use As-Is]
    I -->|No| K[Try Multiple Formats]

    K --> L[1. Try: projectId/handle]
    L --> M[2. Try: orgId/handle]
    M --> N[3. Try: handle as-is]

    H --> O[Return Result]
    J --> O
    N --> O

    %% Display Logic
    O --> P[Remove Prefixes for Display]
    P --> Q[Show: 'my-prompt' to user]
```

## Key Operations Flow

### 1. Create Prompt Flow

```mermaid
sequenceDiagram
    participant Client
    participant PromptService
    participant LlmConfigRepository
    participant LlmConfigVersionsRepository
    participant Database

    Client->>PromptService: createPrompt(params)

    Note over PromptService: Check if version data provided
    alt Has version data
        PromptService->>PromptService: shouldCreateVersion = true
    else No version data
        PromptService->>PromptService: shouldCreateVersion = false
    end

    PromptService->>LlmConfigRepository: createConfigWithInitialVersion()

    LlmConfigRepository->>Database: Create LlmPromptConfig
    Database-->>LlmConfigRepository: Config created

    alt shouldCreateVersion
        LlmConfigRepository->>LlmConfigVersionsRepository: createVersion()
        LlmConfigVersionsRepository->>Database: Create LlmPromptConfigVersion
        Database-->>LlmConfigVersionsRepository: Version created
        LlmConfigVersionsRepository-->>LlmConfigRepository: Version data
    end

    LlmConfigRepository-->>PromptService: Config with version
    PromptService-->>Client: Created prompt
```

### 2. Sync/Conflict Resolution Flow

```mermaid
flowchart TD
    A[syncPrompt Called] --> B[Check if prompt exists]

    B -->|Not Found| C[Create New Prompt]
    C --> D[Create Initial Version]
    D --> E[Return: 'created']

    B -->|Found| F[Check Permissions]
    F -->|No Permission| G[Throw Error]
    F -->|Has Permission| H{Compare Versions}

    H -->|Local = Remote| I[Compare Content]
    I -->|Same Content| J[Return: 'up_to_date']
    I -->|Different Content| K[Create New Version]
    K --> L[Return: 'updated']

    H -->|Local < Remote| M[Check if Local Changed]
    M -->|No Changes| N[Return: 'up_to_date']
    M -->|Has Changes| O[Return: 'conflict']

    H -->|Local > Remote or Unknown| P[Return: 'conflict']

    O --> Q[Include Conflict Info:<br/>- Local Version<br/>- Remote Version<br/>- Differences<br/>- Remote Config Data]
    P --> Q
```

## Schema Versioning

The system supports schema evolution through versioned configuration schemas:

```mermaid
graph LR
    subgraph "Schema V1.0"
        A[configData Structure:<br/>- prompt: string<br/>- messages: Message[]<br/>- inputs: Input[]<br/>- outputs: Output[]<br/>- model: string<br/>- temperature?: number<br/>- max_tokens?: number<br/>- prompting_technique?: object]
    end

    subgraph "Validation Flow"
        B[getSchemaValidator] --> C[Validate configData]
        C --> D[Parse & Transform]
    end

    subgraph "Future Versions"
        E[Schema V2.0<br/>Future enhancements]
    end

    A --> B
    D --> F[Store in Database]
    A -.-> E
```

## Configuration Data Structure

```mermaid
graph TB
    subgraph "LlmPromptConfigVersion.configData"
        CD[configData: JsonValue]

        subgraph "Schema V1.0 Structure"
            P[prompt: string]
            M[messages: Message[]]
            I[inputs: Input[]]
            O[outputs: Output[]]
            MOD[model: string]
            T[temperature?: number]
            MT[max_tokens?: number]
            PT[prompting_technique?: object]
        end

        CD --> P
        CD --> M
        CD --> I
        CD --> O
        CD --> MOD
        CD --> T
        CD --> MT
        CD --> PT
    end

    subgraph "Input Types"
        IT[type: 'str' | 'float' | 'bool' | 'image' | 'list[str]' | etc.]
        II[identifier: string]
    end

    subgraph "Output Types"
        OT[type: 'str' | 'float' | 'bool' | 'json_schema']
        OI[identifier: string]
        JS[json_schema?: object]
    end

    I --> IT
    I --> II
    O --> OT
    O --> OI
    O --> JS
```

## Key Components

### PromptService

- **Purpose**: Business logic layer for prompt operations
- **Responsibilities**:
  - Handle formatting and resolution
  - Prompt CRUD operations
  - Sync and conflict resolution
  - Handle uniqueness validation

### LlmConfigRepository

- **Purpose**: Data access layer for prompt configurations
- **Responsibilities**:
  - Config CRUD operations
  - Handle creation and resolution
  - Permission checking
  - Content comparison

### LlmConfigVersionsRepository

- **Purpose**: Data access layer for prompt versions
- **Responsibilities**:
  - Version CRUD operations
  - Version validation
  - Version history management

### Schema Validation

- **Purpose**: Ensure data integrity across schema versions
- **Features**:
  - Versioned schemas (currently V1.0)
  - Zod-based validation
  - Schema evolution support

## Multi-Tenancy Support

The system supports both project-scoped and organization-scoped prompts:

- **PROJECT scope**: `{projectId}/{handle}` - Accessible within the project
- **ORGANIZATION scope**: `{organizationId}/{handle}` - Accessible across the organization

## Error Handling

- **NotFoundError**: When prompts or versions don't exist
- **Permission Errors**: When users lack modify permissions
- **Validation Errors**: When schema validation fails
- **Conflict Resolution**: Structured conflict information for sync operations

## Usage Examples

### Creating a Prompt

```typescript
const prompt = await promptService.createPrompt({
  projectId: "proj_123",
  organizationId: "org_456",
  handle: "my-prompt",
  scope: "PROJECT",
  authorId: "user_789",
  prompt: "Hello {{name}}!",
  inputs: [{ identifier: "name", type: "str" }],
  outputs: [{ identifier: "response", type: "str" }],
  model: "gpt-4",
});
```

### Syncing a Prompt

```typescript
const result = await promptService.syncPrompt({
  idOrHandle: "my-prompt",
  localConfigData: {
    /* config data */
  },
  localVersion: 1,
  projectId: "proj_123",
  organizationId: "org_456",
  authorId: "user_789",
  commitMessage: "Updated prompt",
});

// Handle different outcomes
switch (result.action) {
  case "created": // New prompt created
  case "updated": // Prompt updated
  case "up_to_date": // No changes needed
  case "conflict": // Manual resolution required
}
```

## Development Notes

- All prompts must have at least one version
- Handles are automatically prefixed with project/organization IDs
- Schema validation ensures data integrity
- Conflict resolution provides detailed diff information
- Permissions are checked for all modify operations
