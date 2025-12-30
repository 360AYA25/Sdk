/**
 * Snapshot Manager
 * Simple snapshot/rollback using n8n API
 */

export interface SnapshotResult {
  success: boolean;
  versionId?: number;
  error?: string;
}

// Store recent snapshots in memory
const snapshots = new Map<string, number[]>();

export async function takeSnapshot(workflowId: string): Promise<SnapshotResult> {
  try {
    const apiUrl = process.env.N8N_API_URL;
    const apiKey = process.env.N8N_API_KEY;

    if (!apiUrl || !apiKey) {
      console.log('[Snapshot] API not configured, skipping');
      return { success: true }; // Skip if not configured
    }

    // Get current workflow version
    const response = await fetch(
      `${apiUrl}/workflows/${workflowId}`,
      {
        headers: {
          'X-N8N-API-KEY': apiKey,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get workflow: ${response.status}`);
    }

    const workflow = await response.json() as { versionId?: number };
    const versionId = workflow.versionId;

    if (versionId === undefined) {
      console.log('[Snapshot] No versionId in workflow');
      return { success: true };
    }

    // Store snapshot
    const existing = snapshots.get(workflowId) ?? [];
    existing.push(versionId);
    snapshots.set(workflowId, existing);

    console.log(`[Snapshot] Saved v${versionId} for ${workflowId}`);

    return { success: true, versionId };
  } catch (error) {
    console.error('[Snapshot] Failed:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function rollback(
  workflowId: string,
  toVersion?: number
): Promise<boolean> {
  try {
    const apiUrl = process.env.N8N_API_URL;
    const apiKey = process.env.N8N_API_KEY;

    if (!apiUrl || !apiKey) {
      console.error('[Rollback] API not configured');
      return false;
    }

    const versions = snapshots.get(workflowId);
    if (!versions || versions.length === 0) {
      console.error('[Rollback] No snapshots found');
      return false;
    }

    const targetVersion = toVersion ?? versions[versions.length - 1];

    // Use n8n API for rollback
    const response = await fetch(
      `${apiUrl}/workflows/${workflowId}/versions/${targetVersion}/rollback`,
      {
        method: 'POST',
        headers: {
          'X-N8N-API-KEY': apiKey,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Rollback failed: ${response.status}`);
    }

    console.log(`[Rollback] Restored to v${targetVersion}`);

    // Remove used snapshot
    if (!toVersion) {
      versions.pop();
    }

    return true;
  } catch (error) {
    console.error('[Rollback] Failed:', error);
    return false;
  }
}

/**
 * Get the last snapshot version for a workflow
 */
export function getLastSnapshot(workflowId: string): number | undefined {
  const versions = snapshots.get(workflowId);
  return versions?.[versions.length - 1];
}

/**
 * Clear all snapshots (for testing)
 */
export function clearSnapshots(): void {
  snapshots.clear();
}
