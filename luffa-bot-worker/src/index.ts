import { LuffaApiClient } from "./luffaApi";
import { parseMessage } from "./messageParser";
import { MsgIdDedupeStore } from "./msgIdDedupeStore";
import { config } from "./config";

interface BackendRoundCandidate {
  id: string;
  animalName: string;
  statement: string;
}

interface BackendRound {
  roundId: string;
  difficulty: number;
  imposterCandidateId?: string;
  imposterIndex?: number;
  explanation?: string;
  candidates: BackendRoundCandidate[];
}

interface StartRunResponse {
  runId: string;
  topic: string;
  roundNumber: number;
  score: number;
  status: string;
  round: BackendRound;
}

interface PrototypeGameState {
  currentRunId: string;
  currentTopic: string;
  currentRound: BackendRound | null;
  currentRoundNumber: number;
  currentScore: number;
  gameActive: boolean;
}

const FIXED_ANIMALS = ["pig", "cat", "bull", "rabbit", "dog"] as const;
const FIXED_ANIMAL_SET = new Set<string>(FIXED_ANIMALS);

const luffaApi = new LuffaApiClient();
const msgIdDedupeStore = new MsgIdDedupeStore(1000);
const POLL_INTERVAL_MS = 1000;
const BACKEND_BASE_URL = config.backendBaseUrl.replace(/\/+$/, "");
const START_RUN_URL = `${BACKEND_BASE_URL}/api/runs`;

const gameState: PrototypeGameState = {
  currentRunId: "",
  currentTopic: "",
  currentRound: null,
  currentRoundNumber: 0,
  currentScore: 0,
  gameActive: false
};

let isPolling = false;

function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function statementByAnimal(round: BackendRound): Record<string, string> {
  const byAnimal: Record<string, string> = {};

  for (const candidate of round.candidates) {
    const byId = (candidate.id ?? "").trim().toLowerCase();
    const byName = (candidate.animalName ?? "").trim().toLowerCase();
    const statement = (candidate.statement ?? "").trim();

    if (!statement) {
      continue;
    }

    if (byId) {
      byAnimal[byId] = statement;
    }

    if (byName) {
      byAnimal[byName] = statement;
    }
  }

  return byAnimal;
}

function formatRoundMessage(
  topic: string,
  round: BackendRound,
  score: number,
  roundNumber: number
): string {
  const byAnimal = statementByAnimal(round);
  const lines = [
    `Topic: ${titleCase(topic)}`,
    `Round: ${roundNumber}`,
    `Score: ${score}`,
    ""
  ];

  for (const animal of FIXED_ANIMALS) {
    const animalLabel = animal.charAt(0).toUpperCase() + animal.slice(1);
    const statement = byAnimal[animal] ?? "...";
    lines.push(`${animalLabel}: ${statement}`);
  }

  lines.push("");
  lines.push("Reply with: pig, cat, bull, rabbit, or dog");

  return lines.join("\n");
}

function formatCorrectMessage(
  topic: string,
  round: BackendRound,
  score: number,
  roundNumber: number
): string {
  return ["Correct.", "", formatRoundMessage(topic, round, score, roundNumber)].join("\n");
}

function formatGameOverMessage(
  score: number,
  correctImposterCandidateId: string,
  explanation: string
): string {
  return [
    "Game over.",
    `Final score: ${score}`,
    `Imposter: ${correctImposterCandidateId}`,
    `Why: ${explanation}`,
    "",
    "Send a topic to start again."
  ].join("\n");
}

function resolveCorrectImposterCandidateId(round: BackendRound): string {
  const byId = (round.imposterCandidateId ?? "").trim().toLowerCase();
  if (byId) {
    return byId;
  }

  const idx = round.imposterIndex;
  if (typeof idx === "number" && Number.isInteger(idx) && idx >= 0 && idx < round.candidates.length) {
    const candidate = round.candidates[idx];
    return (candidate.id || candidate.animalName || "").trim().toLowerCase();
  }

  return "";
}

function resolveExplanation(round: BackendRound, correctImposterCandidateId: string): string {
  const explicit = (round.explanation ?? "").trim();
  if (explicit) {
    return explicit;
  }

  const candidate = round.candidates.find((item) => {
    const id = (item.id ?? "").trim().toLowerCase();
    const name = (item.animalName ?? "").trim().toLowerCase();
    return id === correctImposterCandidateId || name === correctImposterCandidateId;
  });

  if (candidate?.animalName) {
    return `${candidate.animalName} gave the imposter statement.`;
  }

  return "That statement was the imposter for this round.";
}

function clearGameState(): void {
  gameState.currentRunId = "";
  gameState.currentTopic = "";
  gameState.currentRound = null;
  gameState.currentRoundNumber = 0;
  gameState.currentScore = 0;
  gameState.gameActive = false;
  console.log("[state] cleared");
}

async function requestRound(
  topic: string,
  difficulty: number,
  roundNumber: number,
  score: number,
  runId?: string
): Promise<StartRunResponse> {
  console.log("[backend] requesting round");
  console.log(`[backend] url: ${START_RUN_URL}`);

  let response: Response;
  try {
    response = await fetch(START_RUN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        runId,
        topic,
        difficulty,
        roundNumber,
        score
      })
    });
  } catch (error) {
    console.error(`[backend] fetch failed url=${START_RUN_URL}`, error);
    throw error;
  }

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Backend /api/runs failed (${response.status}): ${bodyText}`);
  }

  const data = (await response.json()) as StartRunResponse;

  if (!data?.round || !Array.isArray(data.round.candidates)) {
    throw new Error("Backend /api/runs returned invalid round payload");
  }

  console.log("[backend] round received");
  return data;
}

async function startTopicRound(targetUid: string, topicText: string): Promise<void> {
  const trimmedTopic = topicText.trim();
  if (!trimmedTopic) {
    return;
  }

  console.log(`[topic] received ${trimmedTopic}`);

  try {
    const roundStart = await requestRound(trimmedTopic, 1, 1, 0);

    gameState.currentRunId = roundStart.runId;
    gameState.currentTopic = roundStart.topic;
    gameState.currentRound = roundStart.round;
    gameState.currentScore = roundStart.score;
    gameState.currentRoundNumber = roundStart.roundNumber;
    gameState.gameActive = roundStart.status === "active";

    const reply = formatRoundMessage(
      roundStart.topic,
      roundStart.round,
      gameState.currentScore,
      gameState.currentRoundNumber
    );
    await luffaApi.sendDirectMessage(targetUid, reply);
    console.log("[dm] round sent");
  } catch (error) {
    console.error("[backend] request failed", error);
    await luffaApi.sendDirectMessage(targetUid, "Sorry, I couldn't start a round right now.");
  }
}

async function pollOnce(): Promise<void> {
  if (isPolling) {
    console.log("[poll] skipped: previous poll still running");
    return;
  }

  console.log("[poll] started");
  isPolling = true;

  try {
    const result = await luffaApi.receiveMessages();
    console.log(`[poll] envelopes received: ${result.messages.length}`);

    for (const message of result.messages) {
      try {
        if (!message || typeof message !== "object") {
          console.error("[parse] invalid parsed message candidate", message);
          continue;
        }

        const uid = typeof message.uid === "string" ? message.uid.trim() : "";
        const msgId = typeof message.messageId === "string" ? message.messageId.trim() : "";
        const text = typeof message.text === "string" ? message.text.trim() : "";
        const isGroup = Boolean(message.isGroup);
        const type = isGroup ? "1" : "0";

        console.log("[parse] candidate object:", message);
        console.log(`[parse] uid=${uid} msgId=${msgId} text=${text} type=${type} isGroup=${isGroup}`);

        if (!msgIdDedupeStore.shouldAccept(msgId)) {
          console.log(`[dedupe] skipped duplicate ${msgId}`);
          continue;
        }

        console.log(`[dedupe] accepted ${msgId}`);
        console.log("[poll] message:", message);

        if (isGroup) {
          continue;
        }

        console.log("[dm] classified direct message");

        if (!text) {
          continue;
        }

        const senderUid =
          typeof message.senderUid === "string" ? message.senderUid.trim() : "";
        const targetUid = senderUid || uid;

        if (!gameState.gameActive && FIXED_ANIMAL_SET.has(text.toLowerCase())) {
          await luffaApi.sendDirectMessage(targetUid, "Send a topic first (for example: planets).");
          continue;
        }

        const parsed = parseMessage(text, gameState.gameActive);

        if (parsed.type === "topic") {
          await startTopicRound(targetUid, parsed.topic);
          continue;
        }

        if (parsed.type === "guess") {
          console.log(`[guess] received ${parsed.guess}`);

          if (!gameState.gameActive || !gameState.currentRound) {
            await luffaApi.sendDirectMessage(targetUid, "Send a topic first (for example: planets).");
            continue;
          }

          const correctImposterCandidateId = resolveCorrectImposterCandidateId(gameState.currentRound);

          if (parsed.guess === correctImposterCandidateId) {
            console.log("[guess] correct");
            gameState.currentScore += 1;
            gameState.currentRoundNumber += 1;
            const nextDifficulty = gameState.currentRoundNumber;

            try {
              const nextRound = await requestRound(
                gameState.currentTopic,
                nextDifficulty,
                gameState.currentRoundNumber,
                gameState.currentScore,
                gameState.currentRunId
              );
              gameState.currentRunId = nextRound.runId;
              gameState.currentRound = nextRound.round;
              gameState.gameActive = nextRound.status === "active";

              const reply = formatCorrectMessage(
                gameState.currentTopic,
                nextRound.round,
                gameState.currentScore,
                gameState.currentRoundNumber
              );
              await luffaApi.sendDirectMessage(targetUid, reply);
              console.log("[dm] round sent");
            } catch (error) {
              console.error("[backend] request failed", error);
              await luffaApi.sendDirectMessage(
                targetUid,
                "Sorry, I couldn't start a round right now."
              );
            }

            continue;
          }

          console.log("[guess] wrong");
          const explanation = resolveExplanation(gameState.currentRound, correctImposterCandidateId);

          const gameOverMessage = formatGameOverMessage(
            gameState.currentScore,
            correctImposterCandidateId || "unknown",
            explanation
          );
          await luffaApi.sendDirectMessage(targetUid, gameOverMessage);
          clearGameState();
          continue;
        }

        if (parsed.type === "command") {
          if (parsed.command === "restart" || parsed.command === "quit") {
            clearGameState();
          }

          await luffaApi.sendDirectMessage(targetUid, "Send a topic to start a round (example: planets).");
          continue;
        }

        if (
          parsed.type === "invalid" &&
          gameState.gameActive &&
          !text.trim().startsWith("/") &&
          !FIXED_ANIMAL_SET.has(text.toLowerCase())
        ) {
          console.log("[topic] treating non-animal text as new topic during active game");
          await startTopicRound(targetUid, text);
          continue;
        }

        if (gameState.gameActive) {
          await luffaApi.sendDirectMessage(targetUid, "Reply with: pig, cat, bull, rabbit, or dog.");
        } else {
          await luffaApi.sendDirectMessage(targetUid, "Send a topic to start a round (example: planets).");
        }
      } catch (error) {
        console.error("[dm] reply failed", error);
      }
    }
  } catch (error) {
    console.error("[poll] error", error);
  } finally {
    isPolling = false;
  }
}

console.log("[boot] worker started");
console.log(`[boot] backend base url: ${BACKEND_BASE_URL}`);

void pollOnce();
setInterval(() => {
  void pollOnce();
}, POLL_INTERVAL_MS);
