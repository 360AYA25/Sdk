/**
 * Node Isolation
 * Read only specific nodes from workflow, not the entire thing
 */

export interface IsolatedNode {
  name: string;
  type: string;
  typeVersion: number;
  parameters: Record<string, unknown>;
  inputs: string[];
  outputs: string[];
}

interface WorkflowNode {
  name: string;
  type: string;
  typeVersion: number;
  parameters: Record<string, unknown>;
}

interface WorkflowConnections {
  [sourceName: string]: {
    [outputType: string]: Array<Array<{ node: string }>>;
  };
}

interface WorkflowData {
  nodes?: WorkflowNode[];
  connections?: WorkflowConnections;
}

/**
 * Fetches workflow and extracts only the specified nodes with their connections
 */
export async function getIsolatedNodes(
  workflowId: string,
  nodeNames: string[]
): Promise<string> {
  if (nodeNames.length === 0) {
    return "No specific nodes to isolate.";
  }

  const apiUrl = process.env.N8N_API_URL;
  const apiKey = process.env.N8N_API_KEY;

  if (!apiUrl || !apiKey) {
    return "N8N API not configured.";
  }

  try {
    // Fetch workflow structure (mode=structure for less data)
    const response = await fetch(
      `${apiUrl}/api/v1/workflows/${workflowId}`,
      {
        headers: {
          'X-N8N-API-KEY': apiKey,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get workflow: ${response.status}`);
    }

    const workflow = await response.json() as WorkflowData;

    if (!workflow.nodes) {
      return "Could not load workflow structure.";
    }

    // Filter only needed nodes
    const isolated: IsolatedNode[] = [];

    for (const nodeName of nodeNames) {
      const node = workflow.nodes.find((n) => n.name === nodeName);
      if (!node) continue;

      // Find connections
      const inputs: string[] = [];
      const outputs: string[] = [];

      // Incoming connections
      if (workflow.connections) {
        for (const [source, conns] of Object.entries(workflow.connections)) {
          for (const outputType of Object.values(conns)) {
            for (const connArr of outputType) {
              if (connArr.some((c) => c.node === nodeName)) {
                inputs.push(source);
              }
            }
          }
        }

        // Outgoing connections
        const nodeConns = workflow.connections[nodeName];
        if (nodeConns) {
          for (const outputType of Object.values(nodeConns)) {
            for (const connArr of outputType) {
              for (const target of connArr) {
                outputs.push(target.node);
              }
            }
          }
        }
      }

      isolated.push({
        name: node.name,
        type: node.type,
        typeVersion: node.typeVersion,
        parameters: node.parameters,
        inputs: [...new Set(inputs)],
        outputs: [...new Set(outputs)],
      });
    }

    // Format for prompt
    let result = `## Isolated Node Context (${isolated.length} nodes)\n\n`;

    for (const node of isolated) {
      result += `### ${node.name}\n`;
      result += `Type: ${node.type} v${node.typeVersion}\n`;
      result += `Receives from: ${node.inputs.join(', ') || 'none'}\n`;
      result += `Sends to: ${node.outputs.join(', ') || 'none'}\n`;
      result += `\nParameters:\n\`\`\`json\n${JSON.stringify(node.parameters, null, 2)}\n\`\`\`\n\n`;
    }

    return result;
  } catch (error) {
    console.error('[NodeIsolation] Failed:', error);
    return `Could not isolate nodes: ${(error as Error).message}`;
  }
}

/**
 * Get just the node names from a workflow
 */
export async function getWorkflowNodeNames(workflowId: string): Promise<string[]> {
  const apiUrl = process.env.N8N_API_URL;
  const apiKey = process.env.N8N_API_KEY;

  if (!apiUrl || !apiKey) {
    return [];
  }

  try {
    const response = await fetch(
      `${apiUrl}/api/v1/workflows/${workflowId}`,
      {
        headers: {
          'X-N8N-API-KEY': apiKey,
        },
      }
    );

    if (!response.ok) {
      return [];
    }

    const workflow = await response.json() as WorkflowData;
    return workflow.nodes?.map((n) => n.name) ?? [];
  } catch {
    return [];
  }
}
