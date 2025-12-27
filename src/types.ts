/**
 * ClaudeN8N SDK Types
 * Central type definitions for the 5-agent system
 */

// ============================================
// Stage & State Types
// ============================================

export type Stage =
  | 'clarification'
  | 'research'
  | 'decision'
  | 'credentials'
  | 'implementation'
  | 'build'
  | 'validate'
  | 'test'
  | 'complete'
  | 'blocked';

export type AgentRole = 'architect' | 'researcher' | 'builder' | 'qa' | 'analyst';

export type EscalationLevel = 'L1' | 'L2' | 'L3' | 'L4';

// ============================================
// Session & Context Types
// ============================================

export interface SessionContext {
  id: string;
  workflowId?: string;
  stage: Stage;
  cycle: number;
  startedAt: Date;
  lastUpdatedAt: Date;
  history: ConversationEntry[];
  fixAttempts: FixAttempt[];
  mcpCalls: MCPCall[];
  agentResults: Map<AgentRole, AgentResult>;
  // User requirements extracted from clarification
  requirements?: {
    nodeCount?: number;           // Explicit node count (e.g., "10 nodes")
    explicitRequirements?: string[];  // List of explicit requirements to preserve
  };
  // Pending user confirmation
  pendingConfirmation?: {
    type: 'options' | 'blueprint';
    data: unknown;
  };
}

export interface ConversationEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentRole?: AgentRole;
  timestamp: Date;
  tokens?: number;
}

export interface FixAttempt {
  cycle: number;
  approach: string;
  result: 'success' | 'failed';
  errorType?: string;
  nodesAffected: string[];
  timestamp: Date;
}

export interface MCPCall {
  tool: string;
  type: 'read' | 'mutation' | 'search';
  params: Record<string, unknown>;
  result?: unknown;
  timestamp: Date;
  agentRole: AgentRole;
}

// ============================================
// Agent Result Types
// ============================================

export interface AgentResult {
  agentRole: AgentRole;
  success: boolean;
  data: unknown;
  mcpCalls: MCPCall[];
  timestamp: Date;
}

export interface ResearchFindings {
  hypothesis: string;
  hypothesis_validated: boolean;
  fit_score: number;
  popularity?: number;
  templates_found: TemplateInfo[];
  nodes_found: NodeInfo[];
  existing_workflows: WorkflowInfo[];
  credentials_discovered?: CredentialInfo[];
}

export interface BuildResult {
  workflow_id: string;
  workflow_name: string;
  node_count: number;
  version_id: number;
  graph_hash: string;
  mcp_calls: MCPCall[];
  snapshot_taken: boolean;
  verification: PostBuildVerification;
}

export interface BlueprintResult {
  workflow_name: string;
  description: string;
  nodes: Array<{
    name: string;
    type: string;
    purpose: string;
  }>;
  connections: Array<{
    from: string;
    to: string;
  }>;
  credentials_needed: string[];
}

export interface QAReport {
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  phase_5_executed: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  edit_scope: string[];
  regression_detected: boolean;
  test_results?: TestResult[];
}

export interface AnalystReport {
  root_cause: string;
  timeline: TimelineEntry[];
  agent_grades: Record<AgentRole, number>;
  token_usage: TokenUsage;
  proposed_learnings: ProposedLearning[];
  context_updates: ContextUpdate[];
}

// ============================================
// Supporting Types
// ============================================

export interface TemplateInfo {
  id: number;
  name: string;
  fit_score: number;
  nodes: string[];
}

export interface NodeInfo {
  type: string;
  name: string;
  version: number;
  operations?: string[];
}

export interface WorkflowInfo {
  id: string;
  name: string;
  active: boolean;
  node_count: number;
}

export interface CredentialInfo {
  id: string;
  name: string;
  type: string;
}

export interface PostBuildVerification {
  version_changed: boolean;
  expected_changes_applied: boolean;
  nodes_match: boolean;
  connections_valid: boolean;
}

export interface ValidationError {
  code: string;
  message: string;
  node?: string;
  severity: 'error' | 'critical';
  autoFixable: boolean;
}

export interface ValidationWarning {
  code: string;
  message: string;
  node?: string;
  isFalsePositive: boolean;
}

export interface TestResult {
  testType: 'webhook' | 'form' | 'chat' | 'manual';
  success: boolean;
  executionId?: string;
  output?: unknown;
  error?: string;
}

export interface TimelineEntry {
  timestamp: Date;
  agent: AgentRole;
  action: string;
  result: string;
}

export interface TokenUsage {
  total: number;
  byAgent: Record<AgentRole, number>;
  byCycle: number[];
}

export interface ProposedLearning {
  id: string;
  title: string;
  content: string;
  category: string;
  severity: 'critical' | 'important' | 'normal';
}

export interface ContextUpdate {
  file: string;
  section: string;
  content: string;
}

// ============================================
// Gate Types
// ============================================

export interface GateResult {
  gate: string;
  passed: boolean;
  message?: string;
  data?: unknown;
}

export interface GateViolation {
  gate: string;
  reason: string;
  context: Record<string, unknown>;
  timestamp: Date;
}

// ============================================
// Orchestrator Types
// ============================================

export interface OrchestratorState {
  session: SessionContext;
  currentAgent?: AgentRole;
  pendingHandoff?: AgentHandoff;
  gateViolations: GateViolation[];
}

export interface AgentHandoff {
  from: AgentRole;
  to: AgentRole;
  context: HandoffContext;
  timestamp: Date;
}

export interface HandoffContext {
  requirements?: string;
  research_findings?: ResearchFindings;
  build_result?: BuildResult;
  qa_report?: QAReport;
  edit_scope?: string[];
  already_tried?: FixAttempt[];
}

// ============================================
// Config Types
// ============================================

export interface AgentConfig {
  model: string;
  maxTokens: number;
  skills: string[];
  mcpTools: string[];
  promptFile: string;
  indexFile: string;
  protocols?: string[];
  writePermissions?: string[];
}

export interface GateConfig {
  name: string;
  description: string;
  enforcement: string;
  rules: GateRule[];
  protocol?: string;
  mandatory?: boolean;
}

export interface GateRule {
  condition: string;
  action: string;
  message: string;
}

// ============================================
// ANALYZE MODE Types
// ============================================

export type AgentMode = 'create' | 'analyze';

export type AnalysisStatus =
  | 'loading'
  | 'understanding'
  | 'investigating'
  | 'synthesizing'
  | 'complete';

// Shared Context Store
export interface SharedContext {
  // === RAW DATA (loaded at start) ===
  projectDocs: ProjectDocs;
  workflowData: WorkflowData;
  nodeSchemas: Record<string, NodeSchema>;
  executionHistory: ExecutionHistory;
  supabaseSchema?: DatabaseSchema;

  // === AGENT CONTRIBUTIONS ===
  architectContext: ArchitectAnalysis | null;
  researcherFindings: ResearcherAnalysisFindings | null;
  analystReport: AnalysisReport | null;

  // === INTER-AGENT COMMUNICATION ===
  messageQueue: AgentMessage[];
  resolvedMessages: AgentMessage[];

  // === METADATA ===
  analysisId: string;
  startedAt: Date;
  lastUpdatedAt: Date;
  status: AnalysisStatus;
}

export interface ProjectDocs {
  readme: string | null;
  todo: string | null;
  plan: string | null;
  architecture: string | null;
  contextFiles: Record<string, string>;
}

export interface WorkflowData {
  id: string;
  name: string;
  active: boolean;
  nodes: WorkflowNode[];
  connections: WorkflowConnections;
  settings: Record<string, unknown>;
}

export interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  disabled?: boolean;
  notes?: string;
}

export interface WorkflowConnections {
  [sourceNodeId: string]: {
    [outputType: string]: Array<{
      node: string;
      type: string;
      index: number;
    }[]>;
  };
}

export interface NodeSchema {
  name: string;
  displayName: string;
  description: string;
  version: number;
  properties: NodeProperty[];
  credentials?: CredentialDefinition[];
}

export interface NodeProperty {
  name: string;
  displayName: string;
  type: string;
  required?: boolean;
  default?: unknown;
  options?: Array<{ name: string; value: string }>;
  description?: string;
}

export interface CredentialDefinition {
  name: string;
  required: boolean;
}

export interface ExecutionHistory {
  total: number;
  successRate: number;
  recentExecutions: Execution[];
  errorPatterns: ErrorPattern[];
}

export interface Execution {
  id: string;
  status: 'success' | 'error' | 'waiting';
  startedAt: Date;
  finishedAt?: Date;
  mode: string;
  data?: unknown;
}

export interface ErrorPattern {
  nodeType: string;
  nodeName: string;
  errorType: string;
  count: number;
  lastOccurred: Date;
  message: string;
}

export interface DatabaseSchema {
  tables: TableInfo[];
  functions: FunctionInfo[];
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rowCount?: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
}

export interface FunctionInfo {
  name: string;
  arguments: string;
  returnType: string;
}

// Architect Analysis Output
export interface ArchitectAnalysis {
  businessContext: {
    purpose: string;
    users: string[];
    useCases: string[];
    successMetrics: string[];
  };
  serviceArchitecture: {
    services: ServiceInfo[];
    integrationPattern: string;
  };
  dataFlow: {
    entry: string[];
    processing: string[];
    exit: string[];
    diagram: string;
  };
  designDecisions: DesignDecision[];
  gapAnalysis: {
    planned: string[];
    implemented: string[];
    gaps: string[];
  };
}

export interface ServiceInfo {
  name: string;
  role: string;
  whyChosen: string;
}

export interface DesignDecision {
  decision: string;
  rationale: string;
  tradeoff: string;
}

// Researcher Analysis Output
export interface ResearcherAnalysisFindings {
  nodeAudits: NodeAudit[];
  connectionIssues: ConnectionIssue[];
  executionPatterns: ExecutionPatternAnalysis;
  questionsAsked: number;
  totalIssues: number;
}

export interface NodeAudit {
  nodeName: string;
  nodeType: string;
  typeVersion: number;
  latestVersion?: number;
  issues: NodeIssue[];
  deprecationStatus: 'current' | 'outdated' | 'deprecated';
}

export interface NodeIssue {
  type: 'version' | 'config' | 'credential' | 'connection' | 'expression' | 'logic';
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  suggestion?: string;
  evidence?: string;
}

export interface ConnectionIssue {
  type: 'orphan' | 'dead_end' | 'routing' | 'type_mismatch';
  nodeName: string;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface ExecutionPatternAnalysis {
  successRate: number;
  avgExecutionTime?: number;
  problematicNodes: string[];
  commonErrors: string[];
  recommendations: string[];
}

// Analysis Report Output
export interface AnalysisReport {
  summary: {
    workflowId: string;
    workflowName: string;
    analysisDate: Date;
    criticalIssues: number;
    totalIssues: number;
    overallHealth: 'healthy' | 'needs_attention' | 'critical';
  };

  findings: ReportFinding[];
  recommendations: Recommendation[];
  roadmap: RoadmapItem[];

  agentContributions: {
    architect: string;
    researcher: string;
    analyst: string;
  };

  qaExchanges: QAExchange[];
}

export interface ReportFinding {
  id: string;
  category: 'architecture' | 'implementation' | 'operations' | 'security';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  evidence: string[];
  rootCause?: string;
  affectedNodes?: string[];
}

export interface Recommendation {
  id: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  description: string;
  effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  relatedFindings: string[];
}

export interface RoadmapItem {
  phase: number;
  title: string;
  items: string[];
  dependencies: string[];
  estimatedEffort: string;
}

export interface QAExchange {
  from: AgentRole;
  to: AgentRole;
  question: string;
  answer: string;
  timestamp: Date;
}

// Inter-Agent Message Protocol
export type MessageType = 'question' | 'answer' | 'clarification' | 'notify';
export type MessagePriority = 'critical' | 'high' | 'normal' | 'low';

export interface AgentMessage {
  id: string;
  type: MessageType;
  priority: MessagePriority;

  from: AgentRole;
  to: AgentRole | 'all';

  subject: string;
  content: string;

  // For questions
  context?: Record<string, unknown>;
  expectedResponseType?: 'boolean' | 'text' | 'json';

  // For answers
  inResponseTo?: string;

  // Metadata
  timestamp: Date;
  status: 'pending' | 'processing' | 'resolved' | 'timeout';
  retryCount: number;
}

// Analysis Result
export interface AnalysisResult {
  success: boolean;
  report?: AnalysisReport;
  outputPath?: string;
  analysisId: string;
  error?: string;
}
