const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const FIXED_ANIMALS = ['pig', 'cat', 'bull', 'rabbit', 'dog'];
const MAX_STORED_RUNS = 500;
const MAX_USED_FALSE_CONCEPTS = 40;
const MAX_USED_STATEMENTS = 300;
const MAX_PRIOR_ROUND_SIGNATURES = 80;

const runStore = new Map();
const aiRoundModulePromise = import('./aiRoundGenerator.ts');

function createRunId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTopic(topic) {
  if (typeof topic !== 'string') {
    return 'planets';
  }

  const trimmed = topic.trim();
  return trimmed || 'planets';
}

function topicKey(topic) {
  return topic.trim().toLowerCase();
}

function toAnimalName(id) {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function summarizeCandidates(candidates) {
  return candidates.map((candidate) => `${candidate.id}: ${candidate.statement}`).join(' | ');
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.round(parsed);
}

function toNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.round(parsed);
}

function pruneRunStore() {
  if (runStore.size <= MAX_STORED_RUNS) {
    return;
  }

  const oldest = [...runStore.values()]
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, runStore.size - MAX_STORED_RUNS);

  for (const run of oldest) {
    runStore.delete(run.runId);
  }
}

function createRun(topic) {
  const normalizedTopic = normalizeTopic(topic);
  const run = {
    runId: createRunId(),
    topic: normalizedTopic,
    topicKey: topicKey(normalizedTopic),
    usedFalseConcepts: [],
    usedStatements: [],
    priorRoundSignatures: [],
    updatedAt: Date.now()
  };

  runStore.set(run.runId, run);
  pruneRunStore();

  return run;
}

function getOrCreateRun(requestedRunId, requestedTopic) {
  const normalizedTopic = normalizeTopic(requestedTopic);
  const cleanedRunId = typeof requestedRunId === 'string' ? requestedRunId.trim() : '';

  if (cleanedRunId && runStore.has(cleanedRunId)) {
    const run = runStore.get(cleanedRunId);

    if (run.topicKey !== topicKey(normalizedTopic)) {
      return createRun(normalizedTopic);
    }

    run.updatedAt = Date.now();
    return run;
  }

  return createRun(normalizedTopic);
}

function pushBoundedUnique(list, value, maxSize) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return;
  }

  const existingIndex = list.indexOf(normalized);
  if (existingIndex >= 0) {
    list.splice(existingIndex, 1);
  }

  list.push(normalized);

  if (list.length > maxSize) {
    list.splice(0, list.length - maxSize);
  }
}

function trackRoundUsage(run, analysis) {
  pushBoundedUnique(run.usedFalseConcepts, analysis.falseConceptKey, MAX_USED_FALSE_CONCEPTS);

  for (const statementKey of analysis.statementKeys) {
    pushBoundedUnique(run.usedStatements, statementKey, MAX_USED_STATEMENTS);
  }

  pushBoundedUnique(run.priorRoundSignatures, analysis.roundSignature, MAX_PRIOR_ROUND_SIGNATURES);
  run.updatedAt = Date.now();
}

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/runs', async (req, res) => {
  const requestedTopic = normalizeTopic(req.body?.topic);
  const requestedRunId = typeof req.body?.runId === 'string' ? req.body.runId : '';

  const difficulty = toPositiveInt(req.body?.difficulty, 1);
  const roundNumber = toPositiveInt(req.body?.roundNumber, 1);
  const score = toNonNegativeInt(req.body?.score, 0);

  const run = getOrCreateRun(requestedRunId, requestedTopic);

  try {
    const { generateAiRound, analyzeRound } = await aiRoundModulePromise;

    const aiRound = await generateAiRound(run.topic, difficulty, {
      usedFalseConcepts: run.usedFalseConcepts,
      usedStatements: run.usedStatements,
      priorRoundSignatures: run.priorRoundSignatures
    });

    const analysis = analyzeRound(aiRound);

    const candidatesById = new Map(
      aiRound.candidates.map((candidate) => [candidate.id, candidate])
    );

    const candidates = FIXED_ANIMALS.map((id) => {
      const candidate = candidatesById.get(id);
      if (!candidate) {
        throw new Error(`AI round missing candidate id: ${id}`);
      }

      return {
        id,
        animalName: toAnimalName(id),
        statement: candidate.statement
      };
    });

    const imposterIndex = FIXED_ANIMALS.indexOf(aiRound.imposterCandidateId);
    if (imposterIndex < 0) {
      throw new Error(
        `Invalid imposterCandidateId from AI round: ${aiRound.imposterCandidateId}`
      );
    }

    trackRoundUsage(run, analysis);

    console.info(
      `[api/runs] selected imposterCandidateId=${aiRound.imposterCandidateId} runId=${run.runId}`
    );
    console.info(`[api/runs] false concept key=${analysis.falseConceptKey} runId=${run.runId}`);
    console.info(
      `[api/runs] current run usedFalseConcepts=${JSON.stringify(run.usedFalseConcepts)} runId=${run.runId}`
    );
    console.info(`[api/runs] candidate list=${summarizeCandidates(candidates)} runId=${run.runId}`);

    res.json({
      runId: run.runId,
      topic: aiRound.topic,
      roundNumber,
      score,
      status: 'active',
      round: {
        roundId: `round_${roundNumber}`,
        difficulty: aiRound.difficulty,
        imposterCandidateId: aiRound.imposterCandidateId,
        imposterIndex,
        explanation: aiRound.explanation,
        candidates
      }
    });
  } catch (error) {
    console.error('[api/runs] failed to generate AI round', error);

    res.status(500).json({
      error: 'FAILED_TO_GENERATE_ROUND',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.listen(PORT, () => {
  console.log(`[boot] listening on port ${PORT}`);
  console.log(`Server running on http://localhost:${PORT}`);
});
