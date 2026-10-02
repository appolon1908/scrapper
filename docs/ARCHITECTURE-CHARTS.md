# scrapper — Architecture Charts

> Repository: `appolon1908/scrapper`  
> Baseline branch: `main`  
> Repository-local visual architecture. Keep these diagrams aligned with source, contracts and deployment.

## 1. System context
```mermaid
flowchart LR
 A["Jobs / operators"] --> B["Crawler API + workers"]
 B --> R["scrapper<br/>Business website crawling and enrichment service"]
 R --> S["crawl queue / enrichment state"]
 R --> D["web targets / lead systems"]
```

## 2. Internal component architecture
```mermaid
flowchart TB
 I["Entrypoint / API / CLI / worker"] --> P["Identity, policy, validation"]
 P --> C["Core domain / orchestration"]
 C --> S["State / configuration / persistence"]
 C --> A["Adapters / integrations"]
 A --> X["Approved dependencies"]
 C --> O["Metrics, logs, traces, audit"]
```

## 3. Critical flow
```mermaid
sequenceDiagram
 participant U as Caller
 participant B as scrapper
 participant P as Policy
 participant C as Core
 participant S as State
 participant X as Dependency
 U->>B: Request / event / action
 B->>P: Authenticate + validate
 P-->>B: Decision
 B->>C: Schedule, crawl, extract, normalize and deliver
 C->>S: Read / persist
 C->>X: Bounded integration
 X-->>C: Result / readback
 C-->>U: Normalized response
```

## 4. Deployment and promotion
```mermaid
flowchart LR
 F["Feature branch"] --> T["Tests / validation"]
 T --> PR["Pull request + review"]
 PR --> CI["CI green"]
 CI --> ST["Staging / isolated verification"]
 ST --> EX["Exact-SHA certification"]
 EX --> G{"Production approval?"}
 G -- No --> ST
 G -- Yes --> P["Production promotion"]
 P --> H["Health/readiness + rollback check"]
```

## 5. Observability and recovery
```mermaid
flowchart LR
 R["scrapper"] --> M["Metrics"]
 R --> L["Logs / audit"]
 R --> T["Traces / correlation"]
 M --> O["Observability stack"]
 L --> O
 T --> O
 O --> A["Dashboards / alerts"]
 R --> B["Backup / config snapshot"]
 B --> RR["Restore / rollback rehearsal"]
```

## Ownership notes
- **Role:** Business website crawling and enrichment service
- **Primary boundary:** Crawler API + workers
- **State/config:** crawl queue / enrichment state
- **Dependencies/consumers:** web targets / lead systems
- Cross-repository effects must use reviewed contracts; production effects remain separately gated.
