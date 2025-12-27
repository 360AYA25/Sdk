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
