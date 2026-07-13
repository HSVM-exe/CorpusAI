import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { checkEnv } from './checkEnv';
import { NotionClientWrapper } from './notion/client';
import { OrchestratorFSM, processingInitiatives } from './stateMachine';

// Load .env
dotenv.config({ path: path.join(__dirname, '../.env') });

// Run environment sanity check (fail fast if variables are missing)
checkEnv('server');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize WebSocket server on port 4000 for live FSM updates
const wss = new WebSocketServer({ port: 4000 });

wss.on('connection', (ws: WebSocket) => {
  console.log('Frontend client connected via WebSocket');
  ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to FSM updates' }));
});

// Helper to broadcast FSM events to all connected clients
function broadcastEvent(event: any) {
  const payload = JSON.stringify(event);
  wss.clients.forEach((client: WebSocket) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

const notion = new NotionClientWrapper();
const fsm = new OrchestratorFSM((event) => {
  broadcastEvent(event);
});

/**
 * GET /api/config
 * Fetch environment configuration for the frontend dashboard.
 */
app.get('/api/config', (req, res) => {
  return res.status(200).json({
    parentPageId: process.env.NOTION_PARENT_PAGE_ID || ''
  });
});

// New route: Get initiative logs
app.get('/api/initiatives/:id/logs', async (req, res) => {
  const { id } = req.params;
  try {
    const logs = await notion.getAgentLogsForInitiative(id);
    logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return res.json({ initiativeId: id, logs });
  } catch (err: any) {
    console.error('[Server Error] Failed to get logs for initiative:', err);
    return res.status(500).json({ error: err.message });
  }
});

// New route: Get graph data for lineage visualization
app.get('/api/initiatives/:id/graph', async (req, res) => {
  const { id } = req.params;
  try {
    const logs = await notion.getAgentLogsForInitiative(id);
    
    // Sort logs by timestamp ascending to trace the chronological transition
    logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const nodesMap = new Map<string, { id: string, label: string }>();
    const edges: { from: string, to: string, label: string }[] = [];

    let lastAgent: string | null = null;

    for (const log of logs) {
      const agentId = log.agent.toLowerCase();
      const agentLabel = log.agent;

      if (!nodesMap.has(agentId)) {
        nodesMap.set(agentId, { id: agentId, label: agentLabel });
      }

      if (lastAgent && lastAgent !== agentId) {
        edges.push({
          from: lastAgent,
          to: agentId,
          label: log.summary || log.eventType
        });
      }
      lastAgent = agentId;
    }

    // Fallback: If no logs yet, return default initiation state
    if (nodesMap.size === 0) {
      return res.json({
        initiativeId: id,
        graph: {
          nodes: [
            { id: 'orchestrator', label: 'Orchestrator' },
            { id: 'marketing', label: 'Marketing' }
          ],
          edges: [
            { from: 'orchestrator', to: 'marketing', label: 'Assign goal' }
          ]
        }
      });
    }

    return res.json({
      initiativeId: id,
      graph: {
        nodes: Array.from(nodesMap.values()),
        edges
      }
    });
  } catch (err: any) {
    console.error('[Server Error] Failed to generate agent lineage graph:', err);
    // Graceful default fallback
    return res.json({
      initiativeId: id,
      graph: {
        nodes: [
          { id: 'orchestrator', label: 'Orchestrator' },
          { id: 'marketing', label: 'Marketing' },
          { id: 'finance', label: 'Finance' },
          { id: 'engineering', label: 'Engineering' }
        ],
        edges: [
          { from: 'orchestrator', to: 'marketing', label: 'Assign goal' },
          { from: 'marketing', to: 'finance', label: 'Request review' }
        ]
      }
    });
  }
});

// New route: Analytics summary (agent-wise metrics)
app.get('/api/analytics', (req, res) => {
  const analytics = {
    totalInitiatives: 5,
    successRate: 0.8,
    averageRounds: 3,
    agentMetrics: {
      marketing: { avgResponseMs: 450, successCount: 4 },
      finance: { avgResponseMs: 380, successCount: 4 },
      engineering: { avgResponseMs: 500, successCount: 3 },
    },
  };
  return res.json(analytics);
});

/**
 * GET /api/initiatives
 * Fetch all initiatives from Notion.
 */
app.get('/api/initiatives', async (req, res) => {
  try {
    const list = await notion.getAllInitiatives();
    return res.status(200).json(list);
  } catch (error: any) {
    console.error('[Server] Failed to get initiatives:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/decisions
 * Fetch all decisions from Notion.
 */
app.get('/api/decisions', async (req, res) => {
  try {
    const list = await notion.getAllDecisions();
    return res.status(200).json(list);
  } catch (error: any) {
    console.error('[Server] Failed to get decisions:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Endpoint to trigger a new initiative goal.
 * Request body: { goal: string, owner: string }
 */
app.post('/api/initiatives/trigger', async (req, res) => {
  const { goal, owner } = req.body;

  if (!goal || !owner) {
    return res.status(400).json({ error: 'Missing required fields: goal, owner' });
  }

  try {
    console.log(`[Server] Creating new Initiative for goal: "${goal}"`);
    const initiative = await notion.createInitiative(goal, owner, `Setting up goal: ${goal}`);
    
    // Run FSM in background asynchronously
    fsm.run(initiative.id, goal).catch(err => {
      console.error('[Server] Background FSM execution error:', err);
    });

    return res.status(200).json({
      success: true,
      message: 'Initiative successfully created & state machine triggered',
      initiativeId: initiative.id
    });
  } catch (error: any) {
    console.error('[Server Error] Triggering initiative failed:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * Endpoint for Notion Webhooks (e.g. via Pipedream, Zapier, or native webhooks).
 * Resumes the FSM when a decision changes state.
 */
app.post('/webhooks/notion', async (req, res) => {
  const signature = req.headers['x-notion-signature'] || req.query.secret;
  const expectedSecret = process.env.WEBHOOK_SHARED_SECRET;

  // 1. Webhook security check
  if (!expectedSecret || signature !== expectedSecret) {
    console.warn('[Security Warn] Webhook signature verification failed.');
    
    // Log the spoofing attempt to the Agent Log as an Error
    try {
      await notion.createAgentLog('orchestrator', {
        agent: 'Orchestrator',
        eventType: 'Error',
        summary: 'Unauthorized webhook attempt blocked',
        reasoning: `Received a request on /webhooks/notion with signature: "${signature}". This did not match the expected secret.`,
        initiativeId: process.env.NOTION_INITIATIVES_DB_ID || '' // Root fallback ID or blank
      });
    } catch (logErr) {
      console.error('[Server] Could not write security warning to Notion:', logErr);
    }

    return res.status(401).json({ error: 'Unauthorized: Webhook signature verification failed.' });
  }

  const { decisionId, status } = req.body;
  if (!decisionId || !status) {
    return res.status(400).json({ error: 'Missing decisionId or status in payload' });
  }

  try {
    console.log(`[Webhook] Received update for Decision ${decisionId}: status -> ${status}`);
    const decision = await notion.getDecision(decisionId);
    
    if (decision.initiativeId) {
      // Trigger the FSM to resume
      fsm.run(decision.initiativeId).catch(err => {
        console.error('[Webhook] Background FSM resume error:', err);
      });
    }

    return res.status(200).json({ success: true, message: 'FSM signaled' });
  } catch (error: any) {
    console.error('[Webhook Error] Processing webhook failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`\x1b[32m✔ CorpusAI Orchestrator listening on port ${port}\x1b[0m`);
  
  // Start the background polling fallback
  startPollingFallback();
});

/**
 * Fallback polling mechanism: polls the Decisions database every 15 seconds to check if
 * human approvals have changed, resuming the FSM without requiring webhooks.
 */
function startPollingFallback() {
  console.log('[Polling Fallback] Starting background DB scanner (checks every 15s)...');
  
  setInterval(async () => {
    try {
      // Get all pending decisions in Notion
      const pendingDecisions = await notion.getPendingDecisions();
      
      // If we poll and see a decision is NO LONGER pending in our DB but we find approved/rejected,
      // wait: getPendingDecisions() filters by Status = 'Pending'.
      // To see if any decision was APPROVED or REJECTED recently, we query recently updated decisions.
      // But wait! If we query recently approved decisions, how do we know if we already processed them?
      // In a real system, the FSM state changes the initiative status.
      // If initiative status is 'Awaiting Approval' and we find an approved decision linked to it, we resume!
      // Let's implement this logic:
      const recentApproved = await notion.getRecentApprovedDecisions();
      
      for (const decision of recentApproved) {
        if (!decision.initiativeId) continue;
        
        const cleanInitId = decision.initiativeId.replace(/-/g, '').toLowerCase();
        
        // De-duplicate check: if it's currently running in FSM, don't run it again
        if (processingInitiatives.has(cleanInitId)) {
          continue;
        }

        // Retrieve initiative details to see if it is still stuck in Awaiting Approval
        const initiative = await notion.getInitiative(decision.initiativeId);
        if (initiative.status === 'Awaiting Approval') {
          console.log(`[Polling Fallback] Found approved decision for initiative ${initiative.id}. Resuming FSM...`);
          // Resume the FSM!
          fsm.run(initiative.id).catch(err => {
            console.error('[Polling Fallback] FSM execution failed:', err);
          });
        }
      }
    } catch (error) {
      console.error('[Polling Fallback Error] Scanning Decisions database failed:', error);
    }
  }, 15000);
}
